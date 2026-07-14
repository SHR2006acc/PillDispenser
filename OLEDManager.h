#ifndef OLED_MANAGER_H
#define OLED_MANAGER_H

#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <FluxGarage_RoboEyes.h>
#include <RtcDS1302.h> // ✅ Replaced RTClib with Makuna Rtc

// ---------------------------
// Shared Schedule structure (used by main firmware)
// ---------------------------
struct Schedule
{
    int year;
    int month;
    int day;
    int hour;
    int minute;
    int box;
    bool active;
    uint8_t type;    // ScheduleType (0=ONCE, 1=DAILY, ...)
    uint8_t weekday; // 0=Sunday ... 6=Saturday
};

// ---------------------------
// Shared PillBox structure (used by main firmware for the Pill Status screen)
// ---------------------------
struct PillBox
{
    int box;   // dispenser box number (Box1, Box2, ...)
    int count; // pills remaining
};

#define OLED_SDA 21
#define OLED_SCL 22
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

class OLEDManager
{
public:
    // Type for a callback that returns a static C-string medicine name for a given box
    typedef const char *(*MedicineLookupFn)(int box);

    OLEDManager();

    // Must be called once in setup() – Wire must already be initialised
    void begin();
    // Main update loop – call frequently (every loop())
    void update();

    // ---- Data setters ----
    void setEnvironmentData(float temp, float hum);
    void setRTC(RtcDateTime now); // ✅ Changed to RtcDateTime
    void setSchedules(Schedule *schedules, int count);
    void setWiFiStatus(bool connected, const char *ssid = "");
    void setMedicineLookup(MedicineLookupFn fn);
    void setPillCounts(const PillBox *boxes, int count);
    void clearReminderState();

    // ---- Event triggers ----
    void triggerReminder(int box, const char *medicine);
    void triggerAlert(const char *message, const char *detail);
    void clearAlert();
    void onDispenseComplete();
    void onUserInteraction();
    void onScheduleAdded();

    // ---- Shared helper ----
    // Generates a plausible fallback temperature/humidity reading (used by the
    // main sketch when the DHT11 read fails) so the OLED and the web
    // dashboard both display the same substitute values.
    //   temperature range: 22.0 - 24.0 C
    //   humidity range:    45.0 - 55.0 %
    static void generateFallbackReadings(float &temp, float &hum);

    void triggerMissedDose();             // angry alert + "PLEASE TAKE YOUR MEDICINE"
    void setWorriedReminder();            // sets TIRED mood at 30s (no full alert)
    void onRefill(int box, int newCount); // happy refill with laugh
    void onCupOpened();                   // brief "Cup Opened" confirmation
    void onMedicationCollected();         // brief "Medication Collected" confirmation

private:
    // ---- States ----
    enum State : uint8_t
    {
        STATE_BOOT = 0,
        STATE_ENVIRONMENT,
        STATE_ROBOT_EYES,
        STATE_NEXT_MED,
        STATE_PILL_STATUS,
        STATE_CLOCK,
        STATE_REMINDER,
        STATE_DISPENSING,
        STATE_ALERT,
        STATE_THANK_YOU,
        STATE_REFILL,
        STATE_CUP_OPENED,    // brief "Cup Opened" confirmation
        STATE_CUP_COLLECTED, // brief "Medication Collected" confirmation
        STATE_SCREENSAVER,
        STATE_WAKE
    };

    enum AlertKind : uint8_t
    {
        ALERT_NONE = 0,
        ALERT_TOO_HOT,
        ALERT_TOO_COLD,
        ALERT_TOO_HUMID,
        ALERT_LOW_HUMID,
        ALERT_CUP_MISSING,
        ALERT_NO_PILLS,
        ALERT_SENSOR_FAIL,
        ALERT_WIFI_LOST,
        ALERT_MISSED_DOSE
    };
    int refillBox;
    int refillCount;
    uint8_t refillPhase;
    bool reminderWorried;
    // ---- Timing constants (all in milliseconds) ----
    static constexpr unsigned long BOOT_DURATION_MS = 4500UL;
    static constexpr unsigned long BOOT_DOT_INTERVAL_MS = 300UL; // boot screen refresh cadence
    static constexpr unsigned long EYES_WAKE_DURATION_MS = 2500UL;
    static constexpr unsigned long ROTATION_DURATION_MS = 10000UL; // every normal screen's dwell time
    static constexpr unsigned long NEXT_MED_DURATION_MS = 5000UL;  // when shown as an interrupt via onScheduleAdded()
    static constexpr unsigned long DISPENSING_DURATION_MS = 2200UL;
    static constexpr unsigned long THANK_TEXT_DURATION_MS = 3000UL;
    static constexpr unsigned long THANK_EYES_DURATION_MS = 7000UL; // long happy/laugh phase (~10s screen total)
    static constexpr unsigned long REMINDER_BLINK_MS = 500UL;
    static constexpr unsigned long SCREENSAVER_TIMEOUT_MS = 60000UL;
    static constexpr unsigned long WIFI_ANIM_INTERVAL_MS = 300UL;
    static constexpr unsigned long WAKE_PHASE_MS = 500UL;          // open -> look L -> look R -> smile
    static constexpr unsigned long CUP_EVENT_DURATION_MS = 2200UL; // "Cup Opened" / "Medication Collected" dwell time

    // ---- Screen rotation ----
    // Boot -> Environment -> Robot Eyes -> Next Dose -> Pill Status -> Clock -> repeat
    static const State ROTATION_STATES[];
    static const uint8_t ROTATION_COUNT;
    uint8_t rotationIndex;
    bool nextMedInterrupt; // true if STATE_NEXT_MED was entered via onScheduleAdded() rather than rotation

    // ---- State machine variables ----
    State currentState;
    State previousState;
    State returnState;
    unsigned long stateEnterMs;
    unsigned long lastAnimMs;
    unsigned long lastInteractionMs;
    bool bootComplete;
    uint8_t bootPhase;     // boot animation phase (eyes look L/R/center + smile)
    uint8_t thankYouPhase; // 0 = text, 1 = happy/laugh eyes
    uint8_t wakePhase;     // 0 = open, 1 = look L, 2 = look R, 3 = smile

    // ---- Alert ----
    bool alertActive;
    AlertKind alertKind;
    char alertTitle[18];
    char alertDetail[22];

    // ---- Reminder ----
    int reminderBox;
    char reminderMedicine[24];

    // ---- Cached environment data ----
    float temperature;
    float humidity;
    float lastDrawnTemp;
    float lastDrawnHum;
    RtcDateTime rtcNow; // ✅ Changed to RtcDateTime
    uint32_t lastRtcUnix;
    uint32_t lastClockUnix; // separate change-tracking for the Clock screen
    bool wifiConnected;
    bool lastDrawnWifi;
    char wifiLabel[12];
    int wifiDotCount;
    unsigned long lastWifiAnimTime;

    // ---- Schedules (pointer to external array) ----
    Schedule *schedules;
    int scheduleCount;
    MedicineLookupFn medicineLookup;

    // ---- Cached next dose (to avoid searching twice) ----
    const Schedule *nextDose;
    bool nextDoseValid;

    // ---- Pill stock (pointer to external array) ----
    const PillBox *pillBoxes;
    int pillBoxCount;

    // ---- Render control ----
    bool screenDirty;

    // ---- Display and eyes ----
    Adafruit_SSD1306 display;
    RoboEyes<Adafruit_SSD1306> eyes;

    // ---- Icons (PROGMEM bitmaps) ----
    static const uint8_t ICON_PILL[];
    static const uint8_t ICON_TEMP[];
    static const uint8_t ICON_HUM[];
    static const uint8_t ICON_WIFI[];
    static const uint8_t ICON_WARNING[];
    static const uint8_t ICON_CHECK[];

    // ---- Private methods ----
    void enterState(State next);
    void returnFromInterrupt();
    void advanceRotation();
    bool isHighPriorityState() const;
    void handleStateTimeouts(unsigned long now);
    void handleScreensaver(unsigned long now);
    void applyAlertMood(AlertKind kind);
    void updateEmotionalEyes();

    void markDirty();
    void renderIfNeeded(unsigned long now);
    void renderBoot(unsigned long now);
    void renderEnvironment();
    void renderNextMed();
    void renderPillStatus();
    void renderClock();
    void renderReminder(unsigned long now);
    void renderDispensing();
    void renderAlert();
    void renderThankYou();
    void updateRoboEyes();

    void formatDate(char *buf, size_t len, const RtcDateTime &dt) const; // ✅ Changed
    void formatTime(char *buf, size_t len, const RtcDateTime &dt) const; // ✅ Changed
    void drawCenteredText(int y, const char *text, uint8_t textSize);
    void drawCenteredF(int y, const __FlashStringHelper *text, uint8_t textSize);
    void drawIcon(int x, int y, const uint8_t *bitmap, int w, int h);
    void shortenIfNeeded(char *buf, size_t bufLen, uint8_t textSize); // truncates + adds "..." if too wide for the screen
    void findNextDose();                                              // updates nextDose and nextDoseValid
    AlertKind parseAlertKind(const char *message) const;
    void copyToBuffer(char *dest, size_t len, const char *src) const;
    void renderRefill();
    void renderCupOpened();
    void renderCupCollected();
};

#endif