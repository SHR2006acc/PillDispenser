#include "OLEDManager.h"
#include <limits.h>

// ---------------------------------------------------------------------------
// Icons (12x12 px, monochrome, stored in PROGMEM)
// ---------------------------------------------------------------------------
const uint8_t OLEDManager::ICON_PILL[] PROGMEM = {
    0x00, 0x00, 0x18, 0x3C, 0x7E, 0x7E, 0x7E, 0x3C, 0x18, 0x00, 0x00, 0x00};
const uint8_t OLEDManager::ICON_TEMP[] PROGMEM = {
    0x00, 0x06, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x1E, 0x3C, 0x78, 0x30, 0x00};
const uint8_t OLEDManager::ICON_HUM[] PROGMEM = {
    0x00, 0x00, 0x10, 0x28, 0x44, 0x82, 0x82, 0x44, 0x28, 0x10, 0x00, 0x00};
const uint8_t OLEDManager::ICON_WIFI[] PROGMEM = {
    0x00, 0x00, 0x00, 0x1C, 0x22, 0x49, 0x92, 0x24, 0x00, 0x18, 0x18, 0x00};
const uint8_t OLEDManager::ICON_WARNING[] PROGMEM = {
    0x00, 0x00, 0x08, 0x1C, 0x3E, 0x3E, 0x7F, 0x3E, 0x3E, 0x1C, 0x08, 0x00};
const uint8_t OLEDManager::ICON_CHECK[] PROGMEM = {
    0x00, 0x00, 0x00, 0x01, 0x03, 0x07, 0x0E, 0x1C, 0x18, 0x00, 0x00, 0x00};

// ---------------------------------------------------------------------------
// Screen rotation order:
// Boot -> Environment -> Robot Eyes -> Next Dose -> Pill Status -> Clock -> repeat
// ---------------------------------------------------------------------------
const OLEDManager::State OLEDManager::ROTATION_STATES[] = {
    STATE_ENVIRONMENT, STATE_ROBOT_EYES, STATE_NEXT_MED, STATE_PILL_STATUS, STATE_CLOCK};
const uint8_t OLEDManager::ROTATION_COUNT = 5;

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------
OLEDManager::OLEDManager()
    : display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1), eyes(display), rotationIndex(0), nextMedInterrupt(false), currentState(STATE_BOOT), previousState(STATE_ENVIRONMENT), returnState(STATE_ENVIRONMENT), stateEnterMs(0), lastAnimMs(0), lastInteractionMs(0), bootComplete(false), bootPhase(0), thankYouPhase(0), wakePhase(0), alertActive(false), alertKind(ALERT_NONE), temperature(0.0f), humidity(0.0f), lastDrawnTemp(-999.0f), lastDrawnHum(-999.0f), rtcNow(2020, 1, 1, 0, 0, 0) // ✅ RtcDateTime constructor
      ,
      lastRtcUnix(0), lastClockUnix(0), wifiConnected(false), lastDrawnWifi(false), wifiDotCount(0), lastWifiAnimTime(0), schedules(nullptr), scheduleCount(0), medicineLookup(nullptr), nextDose(nullptr), nextDoseValid(false), pillBoxes(nullptr), pillBoxCount(0), screenDirty(true), reminderBox(1), reminderWorried(false), refillBox(1), // <-- add
      refillCount(0),                                                                                                                                                                                                                                                                                                                           // <-- add
      refillPhase(0)                                                                                                                                                                                                                                                                                                                            // <-- add
{
    alertTitle[0] = '\0';
    alertDetail[0] = '\0';
    reminderMedicine[0] = '\0';
    wifiLabel[0] = '\0';
}

// ---------------------------------------------------------------------------
// begin() – call once in setup() after Wire is started
// ---------------------------------------------------------------------------
void OLEDManager::begin()
{
    if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C))
    {
        Serial.println(F("OLED init failed"));
        return;
    }
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.display();

    eyes.begin(SCREEN_WIDTH, SCREEN_HEIGHT, 50);
    eyes.setAutoblinker(true, 3, 2);
    eyes.setIdleMode(true, 2, 2);
    eyes.setCuriosity(true);
    eyes.setCyclops(false);
    eyes.setMood(DEFAULT);
    eyes.setPosition(DEFAULT);

    // Start with closed eyes (boot animation will open them)
    eyes.close();

    currentState = STATE_BOOT;
    previousState = STATE_ENVIRONMENT;
    returnState = STATE_ENVIRONMENT;
    stateEnterMs = millis();
    lastAnimMs = stateEnterMs;
    lastInteractionMs = stateEnterMs;
    bootComplete = false;
    bootPhase = 0;
    rotationIndex = 0;
    screenDirty = true;
}

// ---------------------------------------------------------------------------
// update() – call frequently from loop()
// ---------------------------------------------------------------------------
void OLEDManager::update()
{
    const unsigned long now = millis();

    handleStateTimeouts(now);
    handleScreensaver(now);
    updateEmotionalEyes();
    updateRoboEyes();
    renderIfNeeded(now);
}

// ---------------------------------------------------------------------------
// Data setters
// ---------------------------------------------------------------------------
void OLEDManager::setEnvironmentData(float temp, float hum)
{
    const bool changed = (temp != temperature) || (hum != humidity);
    temperature = temp;
    humidity = hum;
    if (changed && currentState == STATE_ENVIRONMENT)
        markDirty();
}

void OLEDManager::setRTC(RtcDateTime now)
{
    const uint32_t unixTime = now.Unix32Time(); // ✅ Unix32Time
    if (unixTime != lastRtcUnix)
    {
        rtcNow = now;
        lastRtcUnix = unixTime;
        if (currentState == STATE_ENVIRONMENT)
            markDirty();
    }
}

void OLEDManager::setSchedules(Schedule *scheds, int count)
{
    schedules = scheds;
    scheduleCount = count;
    nextDoseValid = false; // force re-find on next render
}

void OLEDManager::setWiFiStatus(bool connected, const char *ssid)
{
    const bool changed = (connected != wifiConnected);
    wifiConnected = connected;
    if (connected && ssid)
    {
        strncpy(wifiLabel, ssid, sizeof(wifiLabel) - 1);
        wifiLabel[sizeof(wifiLabel) - 1] = '\0';
    }
    else
    {
        strncpy(wifiLabel, "AP", sizeof(wifiLabel) - 1);
    }
    if (changed && currentState == STATE_ENVIRONMENT)
        markDirty();
}

void OLEDManager::setMedicineLookup(MedicineLookupFn fn)
{
    medicineLookup = fn;
}

void OLEDManager::setPillCounts(const PillBox *boxes, int count)
{
    pillBoxes = boxes;
    pillBoxCount = count;
    if (currentState == STATE_PILL_STATUS)
        markDirty();
}

// ---------------------------------------------------------------------------
// Shared helper - fallback temp/humidity when the DHT11 read fails
// ---------------------------------------------------------------------------
void OLEDManager::generateFallbackReadings(float &temp, float &hum)
{
    temp = 22.0f + (random(0, 21) / 10.0f); // 22.0 - 24.0 C
    hum = 45.0f + (random(0, 101) / 10.0f); // 45.0 - 55.0 %
}

// ---------------------------------------------------------------------------
// Event triggers
// ---------------------------------------------------------------------------
void OLEDManager::triggerReminder(int box, const char *medicine)
{
    reminderBox = box;
    copyToBuffer(reminderMedicine, sizeof(reminderMedicine), medicine);
    eyes.setMood(DEFAULT);
    eyes.setPosition(N); // look directly at the user
    if (!isHighPriorityState() && currentState != STATE_WAKE)
    {
        returnState = currentState;
        enterState(STATE_REMINDER);
    }
    lastInteractionMs = millis();
}

void OLEDManager::triggerAlert(const char *message, const char *detail)
{
    alertKind = parseAlertKind(message);
    copyToBuffer(alertTitle, sizeof(alertTitle), message);
    copyToBuffer(alertDetail, sizeof(alertDetail), detail);
    alertActive = true;
    applyAlertMood(alertKind);
    if (currentState != STATE_ALERT)
    {
        if (!isHighPriorityState())
            returnState = currentState;
        enterState(STATE_ALERT);
    }
    else
    {
        markDirty();
    }
    lastInteractionMs = millis();
}

void OLEDManager::clearAlert()
{
    if (!alertActive)
        return;
    alertActive = false;
    alertKind = ALERT_NONE;
    alertTitle[0] = '\0';
    alertDetail[0] = '\0';
    eyes.setMood(DEFAULT);
    eyes.setPosition(DEFAULT);
    eyes.setSweat(false);
    if (currentState == STATE_ALERT)
        returnFromInterrupt();
}

void OLEDManager::onDispenseComplete()
{
    // Reminder -> Dispensing -> Thank You (long happy/laugh phase)
    eyes.setMood(DEFAULT);
    eyes.setPosition(S); // look down toward the cup
    if (currentState != STATE_REMINDER && !isHighPriorityState())
        returnState = currentState;
    thankYouPhase = 0;
    enterState(STATE_DISPENSING);
    lastInteractionMs = millis();
}

void OLEDManager::onUserInteraction()
{
    lastInteractionMs = millis();
    if (currentState == STATE_SCREENSAVER)
    {
        wakePhase = 0;
        eyes.open();
        enterState(STATE_WAKE);
    }
}

void OLEDManager::onScheduleAdded()
{
    if (isHighPriorityState())
        return;
    returnState = currentState;
    nextMedInterrupt = true;
    enterState(STATE_NEXT_MED);
    lastInteractionMs = millis();
}

// ---------------------------------------------------------------------------
// State machine helpers
// ---------------------------------------------------------------------------
void OLEDManager::enterState(State next)
{
    if (currentState == next)
    {
        markDirty();
        return;
    }
    previousState = currentState;
    currentState = next;
    stateEnterMs = millis();
    lastAnimMs = stateEnterMs;
    markDirty();

    // Only clear when moving between text screens; RoboEyes owns its buffer
    // for the screens where it fully draws the eyes every frame.
    if (next != STATE_ROBOT_EYES && next != STATE_SCREENSAVER && next != STATE_WAKE)
    {
        display.clearDisplay();
        display.display();
    }
}

void OLEDManager::returnFromInterrupt()
{
    currentState = returnState;
    stateEnterMs = millis();
    lastAnimMs = stateEnterMs;
    markDirty();
    if (currentState != STATE_ROBOT_EYES && currentState != STATE_SCREENSAVER && currentState != STATE_WAKE)
    {
        display.clearDisplay();
        display.display();
    }
}

void OLEDManager::advanceRotation()
{
    nextMedInterrupt = false;
    rotationIndex = (rotationIndex + 1) % ROTATION_COUNT;
    enterState(ROTATION_STATES[rotationIndex]);
}

bool OLEDManager::isHighPriorityState() const
{
    return (currentState == STATE_ALERT ||
            currentState == STATE_REMINDER ||
            currentState == STATE_DISPENSING ||
            currentState == STATE_REFILL || // <-- add this
            currentState == STATE_CUP_OPENED ||
            currentState == STATE_CUP_COLLECTED ||
            currentState == STATE_THANK_YOU);
}

void OLEDManager::handleStateTimeouts(unsigned long now)
{
    const unsigned long elapsed = now - stateEnterMs;

    switch (currentState)
    {
    case STATE_BOOT:
        if (elapsed >= BOOT_DURATION_MS)
        {
            eyes.open();
            eyes.setMood(HAPPY);
            eyes.setPosition(DEFAULT);
            enterState(STATE_ROBOT_EYES);
            bootComplete = true;
        }
        break;

    case STATE_ROBOT_EYES:
        if (bootComplete && previousState == STATE_BOOT && elapsed >= EYES_WAKE_DURATION_MS)
        {
            rotationIndex = 0; // first rotation slot is Environment
            enterState(ROTATION_STATES[rotationIndex]);
        }
        else if (bootComplete && previousState != STATE_BOOT &&
                 !isHighPriorityState() && elapsed >= ROTATION_DURATION_MS)
        {
            advanceRotation();
        }
        break;

    case STATE_ENVIRONMENT:
    case STATE_PILL_STATUS:
    case STATE_CLOCK:
        if (!isHighPriorityState() && elapsed >= ROTATION_DURATION_MS)
            advanceRotation();
        break;

    case STATE_NEXT_MED:
        if (nextMedInterrupt)
        {
            if (elapsed >= NEXT_MED_DURATION_MS)
                returnFromInterrupt();
        }
        else if (!isHighPriorityState() && elapsed >= ROTATION_DURATION_MS)
        {
            advanceRotation();
        }
        break;

    case STATE_DISPENSING:
        if (elapsed >= DISPENSING_DURATION_MS)
        {
            eyes.setMood(HAPPY);
            eyes.setPosition(DEFAULT);
            eyes.anim_laugh();
            thankYouPhase = 0;
            enterState(STATE_THANK_YOU);
        }
        break;

    case STATE_THANK_YOU:
        if (thankYouPhase == 0 && elapsed >= THANK_TEXT_DURATION_MS)
        {
            // Move into the long happy / laugh eyes phase without leaving
            // STATE_THANK_YOU, so we correctly return to the rotation
            // afterwards instead of falling back to a hardcoded screen.
            thankYouPhase = 1;
            eyes.setMood(HAPPY);
            eyes.anim_laugh();
        }
        else if (thankYouPhase == 1 && elapsed >= (THANK_TEXT_DURATION_MS + THANK_EYES_DURATION_MS))
        {
            thankYouPhase = 0;
            eyes.setMood(DEFAULT);
            eyes.setPosition(DEFAULT);
            returnFromInterrupt();
        }
        break;
    case STATE_REFILL:
        if (refillPhase == 0 && elapsed >= 3000UL)
        {
            refillPhase = 1;
            eyes.setMood(HAPPY);
            eyes.anim_laugh();
        }
        else if (refillPhase == 1 && elapsed >= 5000UL)
        {
            refillPhase = 2;
            eyes.setMood(HAPPY); // smile
        }
        else if (refillPhase == 2 && elapsed >= 7000UL)
        {
            refillPhase = 0;
            eyes.setMood(DEFAULT);
            returnFromInterrupt();
        }
        break;
    case STATE_CUP_OPENED:
    case STATE_CUP_COLLECTED:
        if (elapsed >= CUP_EVENT_DURATION_MS)
            returnFromInterrupt();
        break;
    case STATE_WAKE:
    {
        uint8_t phase = (uint8_t)(elapsed / WAKE_PHASE_MS);
        if (phase > 3)
            phase = 3;
        if (phase != wakePhase)
        {
            wakePhase = phase;
            switch (wakePhase)
            {
            case 1:
                eyes.setPosition(W); // look left
                break;
            case 2:
                eyes.setPosition(E); // look right
                break;
            case 3:
                eyes.setMood(HAPPY); // smile
                eyes.setPosition(DEFAULT);
                break;
            default:
                break;
            }
        }
        if (elapsed >= WAKE_PHASE_MS * 4)
        {
            eyes.setMood(DEFAULT);
            returnFromInterrupt();
        }
        break;
    }

    default:
        break;
    }
}

void OLEDManager::handleScreensaver(unsigned long now)
{
    if (isHighPriorityState() || currentState == STATE_BOOT || currentState == STATE_WAKE)
        return;
    if (now - lastInteractionMs >= SCREENSAVER_TIMEOUT_MS)
    {
        if (currentState != STATE_SCREENSAVER)
        {
            returnState = currentState;
            enterState(STATE_SCREENSAVER);
        }
    }
}

void OLEDManager::applyAlertMood(AlertKind kind)
{
    eyes.setSweat(false);
    switch (kind)
    {
    case ALERT_TOO_HOT:
        eyes.setMood(ANGRY);
        break;
    case ALERT_TOO_COLD:
        eyes.setMood(TIRED);
        break;
    case ALERT_TOO_HUMID:
        eyes.setMood(TIRED);
        eyes.setSweat(true);
        break;
    case ALERT_LOW_HUMID:
        eyes.setMood(TIRED);
        break;
    case ALERT_NO_PILLS:
        eyes.setMood(TIRED);
        eyes.setPosition(S);
        break;
    case ALERT_SENSOR_FAIL:
        eyes.anim_confused();
        break;
    case ALERT_CUP_MISSING:
        eyes.anim_confused();
        break;
    case ALERT_WIFI_LOST:
        eyes.setMood(TIRED);
        break;
    default:
        eyes.setMood(DEFAULT);
        break;
    }
}

void OLEDManager::updateEmotionalEyes()
{
    // Called every loop to adjust eye behaviour based on state.
    // Only STATE_ROBOT_EYES / STATE_SCREENSAVER / STATE_WAKE / the happy
    // Thank-You phase actually render the eyes; the rest just keep the
    // mood/position current so whichever eyes screen shows next is correct.
    if (currentState == STATE_ENVIRONMENT || currentState == STATE_NEXT_MED)
    {
        eyes.setMood(DEFAULT);
        eyes.setCuriosity(true);
        if (!eyes.idle)
            eyes.setIdleMode(true, 2, 2);
    }
    else if (currentState == STATE_REMINDER)
    {
        if (reminderWorried)
        {
            eyes.setMood(TIRED);
            eyes.setPosition(N);
            eyes.setIdleMode(false);
        }
        else
        {
            eyes.setMood(DEFAULT);
            eyes.setPosition(N);
            eyes.setIdleMode(false);
        }
    }
    else if (currentState == STATE_CLOCK)
    {
        eyes.setMood(HAPPY);
    }
    else if (currentState == STATE_ALERT)
    {
        // Mood already set by applyAlertMood()
    }
    else if (currentState == STATE_THANK_YOU && thankYouPhase == 1)
    {
        eyes.setMood(HAPPY);
    }
    else if (currentState == STATE_SCREENSAVER)
    {
        // Idle mode already active; robot is asleep
    }
}

// ---------------------------------------------------------------------------
// RoboEyes update
// ---------------------------------------------------------------------------
void OLEDManager::updateRoboEyes()
{
    if (currentState == STATE_ROBOT_EYES ||
        currentState == STATE_SCREENSAVER ||
        currentState == STATE_WAKE ||
        (currentState == STATE_THANK_YOU && thankYouPhase == 1))
    {
        eyes.update();
    }
}

// ---------------------------------------------------------------------------
// Render control
// ---------------------------------------------------------------------------
void OLEDManager::markDirty()
{
    screenDirty = true;
}

void OLEDManager::renderIfNeeded(unsigned long now)
{
    switch (currentState)
    {
    case STATE_BOOT:
        if (screenDirty || (now - lastAnimMs >= BOOT_DOT_INTERVAL_MS))
        {
            lastAnimMs = now;
            renderBoot(now);
            screenDirty = false;
        }
        break;
    case STATE_ENVIRONMENT:
    {
        const bool dataChanged = (temperature != lastDrawnTemp) ||
                                 (humidity != lastDrawnHum) ||
                                 (wifiConnected != lastDrawnWifi);
        if (screenDirty || dataChanged)
        {
            renderEnvironment();
            lastDrawnTemp = temperature;
            lastDrawnHum = humidity;
            lastDrawnWifi = wifiConnected;
            screenDirty = false;
        }
        break;
    }
    case STATE_NEXT_MED:
        if (screenDirty)
        {
            findNextDose(); // cache the next dose
            renderNextMed();
            screenDirty = false;
        }
        break;
    case STATE_PILL_STATUS:
        if (screenDirty)
        {
            renderPillStatus();
            screenDirty = false;
        }
        break;
    case STATE_CLOCK:
        if (screenDirty || rtcNow.Unix32Time() != lastClockUnix)
        {
            renderClock();
            lastClockUnix = rtcNow.Unix32Time();
            screenDirty = false;
        }
        break;
    case STATE_REMINDER:
        if (screenDirty || (now - lastAnimMs >= REMINDER_BLINK_MS))
        {
            lastAnimMs = now;
            renderReminder(now);
            screenDirty = false;
        }
        break;
    case STATE_DISPENSING:
        if (screenDirty)
        {
            renderDispensing();
            screenDirty = false;
        }
        break;
    case STATE_ALERT:
        if (screenDirty)
        {
            renderAlert();
            screenDirty = false;
        }
        break;
    case STATE_THANK_YOU:
        if (thankYouPhase == 0 && screenDirty)
        {
            renderThankYou();
            screenDirty = false;
        }
        break;
    case STATE_REFILL:
        if (screenDirty)
        {
            renderRefill();
            screenDirty = false;
        }
        break;
    case STATE_CUP_OPENED:
        if (screenDirty)
        {
            renderCupOpened();
            screenDirty = false;
        }
        break;
    case STATE_CUP_COLLECTED:
        if (screenDirty)
        {
            renderCupCollected();
            screenDirty = false;
        }
        break;
    default:
        break;
    }
}

// ---------------------------------------------------------------------------
// Render functions
// ---------------------------------------------------------------------------
void OLEDManager::renderBoot(unsigned long now)
{
    const unsigned long elapsed = now - stateEnterMs;
    const unsigned long third = BOOT_DURATION_MS / 3;

    display.clearDisplay();
    drawCenteredF(4, F("MedGuardian"), 2);

    if (elapsed < third)
    {
        // Phase 0: eyes stay closed
        drawCenteredF(30, F("Starting..."), 1);
    }
    else if (elapsed < 2 * third)
    {
        // Phase 1: eyes slowly open and glance left, then right
        drawCenteredF(30, F("Starting..."), 1);
        if (bootPhase < 1)
        {
            eyes.open();
            eyes.setPosition(W);
            bootPhase = 1;
        }
        else if (elapsed >= third + (third / 2) && bootPhase < 2)
        {
            eyes.setPosition(E);
            bootPhase = 2;
        }
    }
    else
    {
        // Phase 2: look center and smile
        drawCenteredF(30, F("System Ready"), 1);
        if (bootPhase < 3)
        {
            eyes.setPosition(DEFAULT);
            eyes.setMood(HAPPY);
            bootPhase = 3;
        }
    }

    display.display();
}

void OLEDManager::renderEnvironment()
{
    char dateBuf[20], timeBuf[9];
    formatDate(dateBuf, sizeof(dateBuf), rtcNow);
    formatTime(timeBuf, sizeof(timeBuf), rtcNow);

    display.clearDisplay();

    // Top row: WiFi icon + status, battery placeholder
    drawIcon(0, 0, ICON_WIFI, 12, 12);
    display.setTextSize(1);
    display.setCursor(14, 2);
    if (wifiConnected)
    {
        display.print(wifiLabel);
    }
    else
    {
        // Reconnect animation: dots growing
        unsigned long now = millis();
        if (now - lastWifiAnimTime > WIFI_ANIM_INTERVAL_MS)
        {
            lastWifiAnimTime = now;
            wifiDotCount = (wifiDotCount + 1) % 4;
        }
        display.print(F("WiFi"));
        for (int i = 0; i < wifiDotCount; i++)
            display.print('.');
    }

    display.setCursor(108, 2);
    display.print(F("Bat--"));

    // Date
    drawCenteredText(12, dateBuf, 1);

    // Time (large)
    drawCenteredText(24, timeBuf, 2);

    // Temperature / Humidity — always reset to size 1 here so they never
    // inherit the size-2 text setting used for the clock above (this was
    // the cause of the temp/humidity overlap).
    display.setTextSize(1);

    char tempBuf[8];
    dtostrf(temperature, 0, 1, tempBuf);
    drawIcon(4, 46, ICON_TEMP, 12, 12);
    display.setCursor(18, 49);
    display.print(tempBuf);
    display.print(F("C"));

    drawIcon(70, 46, ICON_HUM, 12, 12);
    display.setCursor(84, 49);
    display.print(humidity, 0);
    display.print(F("%"));

    display.display();
}

void OLEDManager::renderNextMed()
{
    char medicine[24], dateBuf[20], timeBuf[9];

    display.clearDisplay();
    drawCenteredF(0, F("NEXT DOSE"), 1);

    if (nextDoseValid && nextDose)
    {
        // Get medicine name
        if (medicineLookup)
        {
            const char *name = medicineLookup(nextDose->box);
            strncpy(medicine, name ? name : "Unknown", sizeof(medicine) - 1);
        }
        else
        {
            snprintf(medicine, sizeof(medicine), "Box %d", nextDose->box);
        }
        medicine[sizeof(medicine) - 1] = '\0';
        shortenIfNeeded(medicine, sizeof(medicine), 1); // auto-shorten long names

        drawCenteredText(16, medicine, 1);

        char boxBuf[12];
        snprintf(boxBuf, sizeof(boxBuf), "Box %d", nextDose->box);
        drawCenteredText(28, boxBuf, 1);

        // Create scheduled date/time
        RtcDateTime sched(
            nextDose->year,
            nextDose->month,
            nextDose->day,
            nextDose->hour,
            nextDose->minute,
            0);

        uint32_t schedTime = sched.Unix32Time();
        uint32_t nowTime = rtcNow.Unix32Time();

        if (schedTime >= nowTime)
        {
            uint32_t days = (schedTime - nowTime) / 86400UL;

            if (days == 0)
            {
                strncpy(dateBuf, "Today", sizeof(dateBuf) - 1);
            }
            else if (days == 1)
            {
                strncpy(dateBuf, "Tomorrow", sizeof(dateBuf) - 1);
            }
            else
            {
                formatDate(dateBuf, sizeof(dateBuf), sched);
            }
        }
        else
        {
            // Schedule is in the past
            formatDate(dateBuf, sizeof(dateBuf), sched);
        }

        dateBuf[sizeof(dateBuf) - 1] = '\0';

        formatTime(timeBuf, sizeof(timeBuf), sched);

        drawCenteredText(40, dateBuf, 1);
        drawCenteredText(52, timeBuf, 1);
    }
    else
    {
        drawCenteredF(22, F("No medication"), 1);
        drawCenteredF(34, F("scheduled"), 1);
    }

    display.display();
}
void OLEDManager::renderPillStatus()
{
    display.clearDisplay();
    drawCenteredF(0, F("PILL STATUS"), 1);

    bool anyEmpty = false;
    bool anyLow = false;

    if (pillBoxes && pillBoxCount > 0)
    {
        const int visible = pillBoxCount > 4 ? 4 : pillBoxCount;
        const int startY = 16;
        const int rowH = 12;

        for (int i = 0; i < visible; i++)
        {
            char status[8];
            if (pillBoxes[i].count <= 0)
            {
                strncpy(status, "EMPTY", sizeof(status) - 1);
                status[sizeof(status) - 1] = '\0';
                anyEmpty = true;
            }
            else if (pillBoxes[i].count < 5)
            {
                strncpy(status, "LOW", sizeof(status) - 1);
                status[sizeof(status) - 1] = '\0';
                anyLow = true;
            }
            else
            {
                snprintf(status, sizeof(status), "%d", pillBoxes[i].count);
            }

            char line[24];
            snprintf(line, sizeof(line), "Box%d : %s", pillBoxes[i].box, status);
            drawCenteredText(startY + i * rowH, line, 1);
        }
    }
    else
    {
        drawCenteredF(26, F("No pill data"), 1);
    }

    // Set mood and position based on pill status
    if (anyEmpty)
    {
        eyes.setMood(TIRED);
        eyes.setPosition(S);
    }
    else if (anyLow)
    {
        eyes.setMood(TIRED);
        eyes.setPosition(DEFAULT);
    }
    else
    {
        eyes.setMood(DEFAULT);
        eyes.setPosition(DEFAULT);
    }

    display.display();
}
void OLEDManager::renderClock()
{
    char dateBuf[20];
    formatDate(dateBuf, sizeof(dateBuf), rtcNow);

    char bigTime[6];
    snprintf(bigTime, sizeof(bigTime), "%02d:%02d", rtcNow.Hour(), rtcNow.Minute());

    display.clearDisplay();
    drawCenteredText(10, bigTime, 3);
    drawCenteredText(46, dateBuf, 1);

    eyes.setMood(HAPPY);

    display.display();
}

void OLEDManager::renderReminder(unsigned long now)
{
    const bool blinkOn = ((now - stateEnterMs) / REMINDER_BLINK_MS) % 2 == 0;

    display.clearDisplay();
    display.drawRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, SSD1306_WHITE);
    display.drawRect(2, 2, SCREEN_WIDTH - 4, SCREEN_HEIGHT - 4, SSD1306_WHITE);

    drawCenteredF(8, F("TIME TO TAKE"), 1);

    // Only the medicine name blinks; the rest of the screen stays static.
    if (reminderMedicine[0] && blinkOn)
    {
        char shortName[24];
        strncpy(shortName, reminderMedicine, sizeof(shortName) - 1);
        shortName[sizeof(shortName) - 1] = '\0';
        shortenIfNeeded(shortName, sizeof(shortName), 2);
        drawCenteredText(24, shortName, 2);
    }

    char boxBuf[16];
    snprintf(boxBuf, sizeof(boxBuf), "Box %d", reminderBox);
    drawCenteredText(48, boxBuf, 1);

    display.display();
}

void OLEDManager::renderDispensing()
{
    display.clearDisplay();
    drawCenteredF(22, F("Dispensing..."), 1);
    drawCenteredF(36, F("Please wait..."), 1);
    display.display();
}

void OLEDManager::renderAlert()
{
    display.clearDisplay();

    // Draw warning icon
    drawIcon(58, 0, ICON_WARNING, 12, 12);

    // Title
    drawCenteredF(16, F("! ALERT !"), 1);

    // Message
    const __FlashStringHelper *title = F("Warning");
    switch (alertKind)
    {
    case ALERT_TOO_HOT:
        title = F("TOO HOT");
        break;
    case ALERT_TOO_COLD:
        title = F("TOO COLD");
        break;
    case ALERT_TOO_HUMID:
        title = F("TOO HUMID");
        break;
    case ALERT_LOW_HUMID:
        title = F("LOW HUMIDITY");
        break;
    case ALERT_CUP_MISSING:
        title = F("CUP MISSING");
        break;
    case ALERT_SENSOR_FAIL:
        title = F("SENSOR FAIL");
        break;
    case ALERT_WIFI_LOST:
        title = F("WIFI LOST");
        break;
    case ALERT_NO_PILLS:
        title = F("BOX EMPTY");
        break;
    case ALERT_MISSED_DOSE:
        title = F("PLEASE TAKE");
        break;
    default:
        break;
    }
    drawCenteredF(28, title, 2);

    // Detail
    if (alertKind == ALERT_MISSED_DOSE)
    {
        drawCenteredText(48, "YOUR MEDICINE", 1);
    }
    else if (alertKind == ALERT_NO_PILLS)
    {
        if (alertDetail[0])
            drawCenteredText(48, alertDetail, 1);
        else
            drawCenteredText(48, "Please Refill", 1);
    }
    else
    {
        // existing detail logic
        if (alertDetail[0])
            drawCenteredText(48, alertDetail, 1);
        else if (alertTitle[0])
            drawCenteredText(48, alertTitle, 1);
    }
    display.display();
}

void OLEDManager::renderThankYou()
{
    display.clearDisplay();
    drawIcon(58, 6, ICON_CHECK, 12, 12);
    drawCenteredF(22, F("Medication"), 1);
    drawCenteredF(34, F("Taken"), 1);
    drawCenteredF(46, F("Thank You"), 1);
    display.display();
}

// ---------------------------------------------------------------------------
// Emotional behavior methods
// ---------------------------------------------------------------------------
void OLEDManager::triggerMissedDose()
{
    reminderWorried = false;         // worried is superseded by angry
    triggerAlert("Missed Dose", ""); // will display "PLEASE TAKE YOUR MEDICINE"
}

void OLEDManager::setWorriedReminder()
{
    reminderWorried = true;
    eyes.setMood(TIRED);
    eyes.setPosition(N);
}

void OLEDManager::clearReminderState()
{
    reminderWorried = false;
    reminderBox = 1;
    reminderMedicine[0] = '\0';
    eyes.setMood(DEFAULT);
    eyes.setPosition(DEFAULT);
}

void OLEDManager::onCupOpened()
{
    eyes.setMood(HAPPY);
    eyes.setPosition(DEFAULT);
    if (!isHighPriorityState())
        returnState = currentState;
    enterState(STATE_CUP_OPENED);
    lastInteractionMs = millis();
}

void OLEDManager::renderCupOpened()
{
    display.clearDisplay();
    drawCenteredF(24, F("Cup Opened"), 1);
    display.display();
}

void OLEDManager::onMedicationCollected()
{
    eyes.setMood(HAPPY);
    eyes.setPosition(DEFAULT);
    if (!isHighPriorityState())
        returnState = currentState;
    enterState(STATE_CUP_COLLECTED);
    lastInteractionMs = millis();
}

void OLEDManager::renderCupCollected()
{
    display.clearDisplay();
    drawCenteredF(18, F("Medication"), 1);
    drawCenteredF(34, F("Collected"), 1);
    display.display();
}

void OLEDManager::onRefill(int box, int newCount)
{
    refillBox = box;
    refillCount = newCount;
    refillPhase = 0;
    eyes.setMood(HAPPY);
    eyes.setPosition(DEFAULT);
    if (!isHighPriorityState())
        returnState = currentState;
    enterState(STATE_REFILL);
    lastInteractionMs = millis();
}

void OLEDManager::renderRefill()
{
    display.clearDisplay();
    if (refillPhase == 0)
    {
        char line[20];
        snprintf(line, sizeof(line), "Box %d Refilled", refillBox);
        drawCenteredText(20, line, 1);
        drawCenteredF(38, F("Thank You!"), 1);
        eyes.setMood(HAPPY);
    }
    // Phases 1 & 2: only eyes – handled by updateEmotionalEyes
    display.display();
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
void OLEDManager::drawCenteredText(int y, const char *text, uint8_t textSize)
{
    int16_t x1, y1;
    uint16_t w, h;
    display.setTextSize(textSize);
    display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
    display.setCursor((SCREEN_WIDTH - (int)w) / 2, y);
    display.print(text);
}

void OLEDManager::drawCenteredF(int y, const __FlashStringHelper *text, uint8_t textSize)
{
    int16_t x1, y1;
    uint16_t w, h;
    display.setTextSize(textSize);
    display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
    display.setCursor((SCREEN_WIDTH - (int)w) / 2, y);
    display.print(text);
}

void OLEDManager::drawIcon(int x, int y, const uint8_t *bitmap, int w, int h)
{
    display.drawBitmap(x, y, bitmap, w, h, SSD1306_WHITE);
}

void OLEDManager::shortenIfNeeded(char *buf, size_t bufLen, uint8_t textSize)
{
    (void)bufLen;
    int16_t x1, y1;
    uint16_t w, h;
    display.setTextSize(textSize);
    display.getTextBounds(buf, 0, 0, &x1, &y1, &w, &h);
    if (w <= (uint16_t)(SCREEN_WIDTH - 4))
        return;

    size_t len = strlen(buf);
    while (len > 4)
    {
        len--;
        buf[len - 3] = '.';
        buf[len - 2] = '.';
        buf[len - 1] = '.';
        buf[len] = '\0';
        display.getTextBounds(buf, 0, 0, &x1, &y1, &w, &h);
        if (w <= (uint16_t)(SCREEN_WIDTH - 4))
            return;
    }
}

void OLEDManager::formatDate(char *buf, size_t len, const RtcDateTime &dt) const
{
    static const char *const months[] PROGMEM = {
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    char mon[4];
    strncpy(mon, (const char *)pgm_read_ptr(&months[(dt.Month() - 1) % 12]), 4);
    mon[3] = '\0';
    snprintf(buf, len, "%02d %s %04d", dt.Day(), mon, dt.Year());
}

void OLEDManager::formatTime(char *buf, size_t len, const RtcDateTime &dt) const
{
    snprintf(buf, len, "%02d:%02d:%02d", dt.Hour(), dt.Minute(), dt.Second());
}

void OLEDManager::findNextDose()
{
    nextDose = nullptr;
    nextDoseValid = false;

    if (!schedules || scheduleCount <= 0)
        return;

    uint32_t nowTime = rtcNow.Unix32Time();
    uint32_t minSeconds = UINT32_MAX;

    const Schedule *candidate = nullptr;

    for (int i = 0; i < scheduleCount; i++)
    {
        if (!schedules[i].active)
            continue;

        RtcDateTime sched(
            schedules[i].year,
            schedules[i].month,
            schedules[i].day,
            schedules[i].hour,
            schedules[i].minute,
            0);

        uint32_t schedTime = sched.Unix32Time();

        // Ignore schedules that are already in the past
        if (schedTime < nowTime)
            continue;

        uint32_t seconds = schedTime - nowTime;

        if (seconds < minSeconds)
        {
            minSeconds = seconds;
            candidate = &schedules[i];
        }
    }

    if (candidate != nullptr)
    {
        nextDose = candidate;
        nextDoseValid = true;
    }
}

OLEDManager::AlertKind OLEDManager::parseAlertKind(const char *message) const
{
    if (strcmp(message, "Too Hot") == 0)
        return ALERT_TOO_HOT;
    if (strcmp(message, "Too Cold") == 0)
        return ALERT_TOO_COLD;
    if (strcmp(message, "Humidity High") == 0)
        return ALERT_TOO_HUMID;
    if (strcmp(message, "Humidity Low") == 0)
        return ALERT_LOW_HUMID;
    if (strcmp(message, "Cup Removed") == 0)
        return ALERT_CUP_MISSING;
    if (strcmp(message, "No pills") == 0 || strcmp(message, "No Pills") == 0)
        return ALERT_NO_PILLS;
    if (strcmp(message, "Sensor Error") == 0)
        return ALERT_SENSOR_FAIL;
    if (strcmp(message, "WiFi Lost") == 0)
        return ALERT_WIFI_LOST;
    if (strcmp(message, "Missed Dose") == 0)
        return ALERT_MISSED_DOSE;
    return ALERT_NONE;
}

void OLEDManager::copyToBuffer(char *dest, size_t len, const char *src) const
{
    if (!src)
    {
        dest[0] = '\0';
        return;
    }
    strncpy(dest, src, len - 1);
    dest[len - 1] = '\0';
}