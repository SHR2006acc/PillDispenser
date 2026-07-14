#ifndef AUDIO_MANAGER_H
#define AUDIO_MANAGER_H

#include <Arduino.h>
#include <DFRobotDFPlayerMini.h> // Library Manager: "DFRobotDFPlayerMini" by DFRobot

// =============================================================================
// Voice track IDs
// -----------------------------------------------------------------------------
// These MUST match the numbered mp3 files on the microSD card
// (0001.mp3, 0002.mp3 ... in the card's root folder).
// =============================================================================
enum VoiceTrack : uint8_t
{
    VOICE_NONE = 0,
    VOICE_WELCOME = 1,          // "Welcome to MedGuardian"
    VOICE_TIME_TO_TAKE = 2,     // "It's time to take your medication"
    VOICE_MED_READY = 3,        // "Your medication is ready"
    VOICE_HIGH_TEMP = 4,        // "Warning: High temperature detected"
    VOICE_HIGH_HUMIDITY = 5,    // "Warning: High humidity detected"
    VOICE_DISPENSE_BOX1 = 6,    // "Please dispense dispenser one"
    VOICE_DISPENSE_BOX2 = 7,    // "Please dispense dispenser two"
    VOICE_DISPENSE_SUCCESS = 8, // "Medication dispensed successfully"
    VOICE_THANK_YOU = 9,        // "Thank you, stay healthy"
    VOICE_REFILL_COMPLETE = 10  // "Refill completed successfully"
};

// Number of real tracks (VOICE_NONE is not a real track) - used to size
// internal per-track bookkeeping arrays.
#define AUDIO_TRACK_COUNT 11

// =============================================================================
// AudioManager
// -----------------------------------------------------------------------------
// Thin, self-contained wrapper around the DFPlayer Mini that:
//   - is 100% non-blocking (uses millis(), never delay())
//   - never overlaps two voice lines (single-slot queue, plays sequentially)
//   - never repeats the same line back-to-back (debounced)
//   - fails "silently": if the DFPlayer/SD card isn't detected at begin(),
//     every play*() call becomes a harmless no-op and the rest of the
//     firmware (OLED, servos, WiFi, schedules...) is completely unaffected.
//
// Usage:
//   AudioManager audioManager;
//   setup()  -> audioManager.begin(DFPLAYER_RX, DFPLAYER_TX);
//   loop()   -> audioManager.update();   // call every loop, like oledManager
//   events   -> audioManager.playWelcome(), .playReminder(), ...
// =============================================================================
class AudioManager
{
public:
    AudioManager();

    // Call once from setup(), after Serial.begin(). Wires the DFPlayer Mini on
    // an ESP32 HardwareSerial port (Serial2 by default - matches DFPLAYER_RX /
    // DFPLAYER_TX already defined in the main sketch).
    //
    // NOTE: this performs a short blocking handshake with the module (a few
    // hundred ms, library-internal) but this happens ONCE at boot, never
    // inside loop(), so it does not violate the "no delay in loop" rule.
    //
    // Returns true if the module + SD card were detected. If it returns
    // false, the rest of the project keeps working normally - audio is
    // simply disabled.
    bool begin(int rxPin, int txPin, HardwareSerial &serialPort = Serial2);

    // Must be called every loop() iteration. Fully non-blocking:
    //  - polls the DFPlayer for "track finished" / error notifications
    //  - starts the next queued track (if any) once the current one ends
    //  - applies a safety timeout in case a "finished" notification is missed
    void update();

    bool isAvailable() const; // false if module/SD failed at begin()
    bool isPlaying() const;

    // Stops audio immediately and clears the queue (e.g. on emergencyStop()).
    void stopAll();

    // 0-30. No-op if the module isn't available.
    void setVolume(uint8_t volume);

    // ---- Low-level API ----
    // Plays `track` immediately if nothing is currently playing. If audio is
    // already playing, `track` is placed in a single-slot queue and starts as
    // soon as the current clip finishes - this is what guarantees voices
    // never overlap. A duplicate request for a track that is already
    // playing/queued, or that just finished a moment ago, is ignored so the
    // same line never repeats back-to-back.
    void playTrack(VoiceTrack track);

    // ---- High-level helpers - one per voice line, map 1:1 to the events ----
    void playWelcome();            // 0001 - played once at startup
    void playReminder();           // 0002 - escalated "time to take medication" nudge
    void playMedicationReady();    // 0003 - dispensing has started
    void playTempWarning();        // 0004 - high temperature alert
    void playHumidityWarning();    // 0005 - high humidity alert
    void playDispenseBox(int box); // 0006 / 0007 - "please dispense dispenser N"
    void playDispenseSuccess();    // 0008 - dispensing finished successfully
    void playThankYou();           // 0009 - closing message after a successful dose
    void playRefill();             // 0010 - refill completed

private:
    DFRobotDFPlayerMini dfPlayer;
    HardwareSerial *serial;

    bool available; // module detected & responding at begin()
    bool playing;
    VoiceTrack currentTrack;
    VoiceTrack queuedTrack;
    unsigned long playStartMs;
    unsigned long lastPlayedMs[AUDIO_TRACK_COUNT]; // debounce, indexed by track id

    static const unsigned long MAX_TRACK_DURATION_MS = 8000UL;  // stuck-track safety net
    static const unsigned long MIN_REPEAT_INTERVAL_MS = 4000UL; // ignore rapid duplicate requests

    void startPlaying(VoiceTrack track);
    void onTrackFinished(); // shared by "finished" event + safety timeout
};

#endif
