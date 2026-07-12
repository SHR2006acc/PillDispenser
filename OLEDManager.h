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

    // ---- Event triggers ----
    void triggerReminder(int box, const char *medicine);
    void triggerAlert(const char *message, const char *detail);
    void clearAlert();
    void onDispenseComplete();
    void onUserInteraction();
    void onScheduleAdded();

private:
    // ---- States ----
    enum State : uint8_t
    {
        STATE_BOOT = 0,
        STATE_ENVIRONMENT,
        STATE_ROBOT_EYES,
        STATE_NEXT_MED,
        STATE_REMINDER,
        STATE_ALERT,
        STATE_THANK_YOU,
        STATE_SCREENSAVER
    };

    enum AlertKind : uint8_t
    {
        ALERT_NONE = 0,
        ALERT_TOO_HOT,
        ALERT_TOO_HUMID,
        ALERT_CUP_MISSING,
        ALERT_NO_PILLS,
        ALERT_SENSOR_FAIL,
        ALERT_WIFI_LOST
    };

    // ---- Timing constants (all in milliseconds) ----
    static constexpr unsigned long BOOT_DURATION_MS = 3500UL;
    static constexpr unsigned long BOOT_DOT_INTERVAL_MS = 400UL;
    static constexpr unsigned long EYES_WAKE_DURATION_MS = 2500UL;
    static constexpr unsigned long ENV_DURATION_MS = 8000UL;
    static constexpr unsigned long EYES_DURATION_MS = 10000UL;
    static constexpr unsigned long NEXT_MED_DURATION_MS = 5000UL;
    static constexpr unsigned long THANK_TEXT_DURATION_MS = 2200UL;
    static constexpr unsigned long THANK_EYES_DURATION_MS = 2800UL;
    static constexpr unsigned long REMINDER_BLINK_MS = 500UL;
    static constexpr unsigned long SCREENSAVER_TIMEOUT_MS = 60000UL;
    static constexpr unsigned long WIFI_ANIM_INTERVAL_MS = 300UL;

    // ---- State machine variables ----
    State currentState;
    State previousState;
    State returnState;
    unsigned long stateEnterMs;
    unsigned long lastAnimMs;
    unsigned long lastInteractionMs;
    bool bootComplete;
    uint8_t thankYouPhase; // 0 = text, 1 = happy eyes

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
    void renderReminder(unsigned long now);
    void renderAlert();
    void renderThankYou();
    void updateRoboEyes();

    void formatDate(char *buf, size_t len, const RtcDateTime &dt) const; // ✅ Changed
    void formatTime(char *buf, size_t len, const RtcDateTime &dt) const; // ✅ Changed
    void drawCenteredText(int y, const char *text, uint8_t textSize);
    void drawCenteredF(int y, const __FlashStringHelper *text, uint8_t textSize);
    void drawIcon(int x, int y, const uint8_t *bitmap, int w, int h);
    void findNextDose(); // updates nextDose and nextDoseValid
    AlertKind parseAlertKind(const char *message) const;
    void copyToBuffer(char *dest, size_t len, const char *src) const;
};

#endif