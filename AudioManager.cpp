#include "AudioManager.h"

AudioManager::AudioManager()
    : serial(nullptr),
      available(false),
      playing(false),
      currentTrack(VOICE_NONE),
      queuedTrack(VOICE_NONE),
      playStartMs(0)
{
    for (int i = 0; i < AUDIO_TRACK_COUNT; i++)
    {
        lastPlayedMs[i] = 0;
    }
}

bool AudioManager::begin(int rxPin, int txPin, HardwareSerial &serialPort)
{
    serial = &serialPort;
    serial->begin(9600, SERIAL_8N1, rxPin, txPin);

    // One-time handshake with the module. If it doesn't respond (missing
    // module, bad wiring, no SD card), we simply mark audio unavailable and
    // move on - everything else in the project keeps running.
    available = dfPlayer.begin(*serial, /*isACK=*/true, /*doReset=*/true);

    if (!available)
    {
        Serial.println("⚠️ DFPlayer Mini not detected - audio disabled, rest of the system continues normally.");
        return false;
    }

    dfPlayer.volume(22); // sensible default (range 0-30)
    Serial.println("✅ DFPlayer Mini initialized");
    return true;
}

void AudioManager::update()
{
    if (!available)
        return; // no module -> nothing to poll, no-op forever

    // ---- Poll for async messages from the module (non-blocking) ----
    if (dfPlayer.available())
    {
        uint8_t type = dfPlayer.readType();
        int value = dfPlayer.read(); // clears the pending message

        switch (type)
        {
        case DFPlayerPlayFinished:
            onTrackFinished();
            break;

        case DFPlayerError:
            Serial.printf("⚠️ DFPlayer error code %d - skipping this voice line\n", value);
            playing = false;
            currentTrack = VOICE_NONE;
            // Still try to move on to whatever was queued, so one bad
            // playback doesn't permanently jam the audio queue.
            if (queuedTrack != VOICE_NONE)
            {
                VoiceTrack next = queuedTrack;
                queuedTrack = VOICE_NONE;
                startPlaying(next);
            }
            break;

        default:
            // Card inserted/removed, USB events, feedback ack, etc. - ignored
            break;
        }
    }

    // ---- Safety timeout ----
    // If a "finished" notification is ever missed (noisy UART, edge-case
    // module firmware), don't let the manager think forever that a track is
    // still playing - that would silently block every future event.
    if (playing && (millis() - playStartMs > MAX_TRACK_DURATION_MS))
    {
        onTrackFinished();
    }
}

void AudioManager::onTrackFinished()
{
    playing = false;
    currentTrack = VOICE_NONE;

    if (queuedTrack != VOICE_NONE)
    {
        VoiceTrack next = queuedTrack;
        queuedTrack = VOICE_NONE;
        startPlaying(next);
    }
}

bool AudioManager::isAvailable() const { return available; }
bool AudioManager::isPlaying() const { return playing; }

void AudioManager::stopAll()
{
    if (!available)
        return;

    dfPlayer.stop();
    playing = false;
    currentTrack = VOICE_NONE;
    queuedTrack = VOICE_NONE;
}

void AudioManager::setVolume(uint8_t volume)
{
    if (!available)
        return;

    if (volume > 30)
        volume = 30;
    dfPlayer.volume(volume);
}

void AudioManager::playTrack(VoiceTrack track)
{
    if (!available || track == VOICE_NONE)
        return; // module missing, or nothing to play - safe no-op

    unsigned long now = millis();

    // Debounce: ignore a request for a track that already played very
    // recently. Callers should still edge-trigger their events (e.g. only
    // call playTempWarning() when the alert first turns on, not on every
    // sensor read) - this is a safety net, not the primary defense.
    if (lastPlayedMs[track] != 0 && (now - lastPlayedMs[track] < MIN_REPEAT_INTERVAL_MS))
    {
        return;
    }

    if (!playing)
    {
        startPlaying(track);
        return;
    }

    // Something is already playing - never talk over it. Queue this request
    // (single slot: the latest request wins) so it plays right after the
    // current clip finishes. Skip queueing if it's a duplicate of what's
    // already playing or already queued.
    if (currentTrack != track && queuedTrack != track)
    {
        queuedTrack = track;
    }
}

void AudioManager::startPlaying(VoiceTrack track)
{
    dfPlayer.play((int)track);
    playing = true;
    currentTrack = track;
    playStartMs = millis();
    lastPlayedMs[track] = playStartMs;
}

// ---- High-level helpers ----
void AudioManager::playWelcome() { playTrack(VOICE_WELCOME); }
void AudioManager::playReminder() { playTrack(VOICE_TIME_TO_TAKE); }
void AudioManager::playMedicationReady() { playTrack(VOICE_MED_READY); }
void AudioManager::playTempWarning() { playTrack(VOICE_HIGH_TEMP); }
void AudioManager::playHumidityWarning() { playTrack(VOICE_HIGH_HUMIDITY); }

void AudioManager::playDispenseBox(int box)
{
    if (box == 1)
        playTrack(VOICE_DISPENSE_BOX1);
    else if (box == 2)
        playTrack(VOICE_DISPENSE_BOX2);
}

void AudioManager::playDispenseSuccess() { playTrack(VOICE_DISPENSE_SUCCESS); }
void AudioManager::playThankYou() { playTrack(VOICE_THANK_YOU); }
void AudioManager::playRefill() { playTrack(VOICE_REFILL_COMPLETE); }
