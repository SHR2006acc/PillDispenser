// ============================
// MedGuardian - FINAL Includes
// ============================

#include <ESP32Servo.h>
#include <AsyncTCP.h>          // ✅ AsyncTCP
#include <ESPAsyncWebServer.h> // ✅ ESPAsyncWebServer (CORRECT!)
#include <Wire.h>
#include <ThreeWire.h> // ✅ For DS1302
#include <RtcDS1302.h> // ✅ Makuna Rtc library
#include <LittleFS.h>
#include <WiFi.h>

// Sensors
#include <DHT.h>
#include <Adafruit_Sensor.h>
// #include <HX711.h>

#include <Preferences.h>
#include <ArduinoJson.h>

#include "OLEDManager.h"

// ============================
// CORRECTED Pin Definitions
// ============================

#include <esp_heap_caps.h>

void printHeap(const char *label)
{
    Serial.printf(
        "\n[%s]\n"
        "Free Heap     : %u\n"
        "Max Alloc     : %u\n"
        "Largest Block : %u\n\n",
        label,
        ESP.getFreeHeap(),
        ESP.getMaxAllocHeap(),
        heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
}

// ===== I2C Bus =====
#define SDA_PIN 21
#define SCL_PIN 22

// ===== DS1302 RTC Pins =====
#define RTC_DAT 15 // Choose any free GPIO
#define RTC_CLK 19 // Not used elsewhere
#define RTC_RST 5  // Not used elsewhere

// ===== Servos (PWM capable) =====
#define SERVO1_PIN 18
#define SERVO2_PIN 13

// ===== Buttons (Input Pullup) =====
#define BUTTON1_PIN 25
#define BUTTON2_PIN 26

// ===== LEDs =====
#define LED1_PIN 27 // Box 1 LED
#define LED2_PIN 32 // Box 2 LED

// ===== Sensors =====
#define DHT_PIN 14
#define DHT_TYPE DHT11

// ✅ CORRECTED HX711 pins
// #define HX711_DOUT 35 // GPIO35 = INPUT ONLY (perfect for DOUT)
// #define HX711_SCK 33  // GPIO33 = OUTPUT capable (clock signal)

// ===== IR Break Beam (Input only) =====
#define IR_SENSOR_PIN 34 // GPIO34 = INPUT ONLY

// ===== Audio =====
#define BUZZER_PIN 4

// ===== DFPlayer Mini =====
#define DFPLAYER_RX 16
#define DFPLAYER_TX 17

//======= Wiffi led
#define WLED_BUILTIN 2 // GPIO2 = OUTPUT capable (onboard LED)

// ============================
// Constants
// ============================
#define MAX_SCHEDULES 30
#define DISPENSE_TIME 500
#define DEBOUNCE_TIME 300
#define SENSOR_READ_INTERVAL 2000
// #define EMPTY_CUP_WEIGHT 0.200 // 200g in kg
// #define WEIGHT_THRESHOLD 0.050 // 50g threshold
#define BUZZER_BEEP_DURATION 100
#define WATCHDOG_RESET_INTERVAL 5000

// ============================
// WiFi Configuration - Add after includes
// ============================
// ⚠️ CHANGE THESE TO YOUR HOME WiFi
const char *WIFI_SSID = "inwi Home 4G 54A273"; // ← YOUR WiFi name
const char *WIFI_PASSWORD = "36751273";        // ← YOUR WiFi password

// WiFi settings
const unsigned long WIFI_TIMEOUT = 30000; // 30 seconds
bool wifiConnected = false;
unsigned long lastWiFiCheck = 0;
unsigned long lastWiFiReconnectAttempt = 0;
const unsigned long WIFI_RETRY_INTERVAL = 30000; // Retry every 30 seconds

// ============================
// Session Authentication
// ============================
const char *ADMIN_PIN = "1234"; // ← CHANGE THIS PIN!
bool sessionValid = false;
unsigned long sessionStartTime = 0;
const unsigned long SESSION_TIMEOUT = 3600000; // 1 hour (in milliseconds)

// ============================
// History & Notifications Storage
// ============================

// Add these global variables
#define HISTORY_FILE "/history.json"
#define NOTIFICATIONS_FILE "/notifications.json"

// ============================
// Data Retention Rules - SMART CLEANUP
// ============================
#define MAX_HISTORY_ENTRIES 1000      // Keep up to 1000 medication records
#define MAX_NOTIFICATIONS 50          // Keep last 50 notifications
#define NOTIFICATION_RETENTION_DAYS 7 // Delete notifications after 7 days
#define CLEANUP_INTERVAL 86400000     // Run cleanup once per day (24 hours)
unsigned long lastCleanupTime = 0;

// ============================
// Global Variables
// ============================
Servo servo1;
Servo servo2;

// RTC DS1302
ThreeWire myWire(RTC_DAT, RTC_CLK, RTC_RST);
RtcDS1302<ThreeWire> Rtc(myWire);

DHT dht(DHT_PIN, DHT_TYPE);
// HX711 scale;
AsyncWebServer server(80);
Preferences preferences;

// ✅ ADD THIS - Track RTC status
bool rtcInitialized = false;

Schedule medSchedules[MAX_SCHEDULES];

OLEDManager oledManager;
// Dispensing state
bool isDispensing1 = false;
bool isDispensing2 = false;
unsigned long startTime1 = 0;
unsigned long startTime2 = 0;

// Sensor data
float temperature = 0;
float humidity = 0;
// float weight = 0;

// Button debounce
unsigned long lastButtonTime = 0;
int lastTriggeredYear[MAX_SCHEDULES] = {0};
int lastTriggeredMonth[MAX_SCHEDULES] = {0};
int lastTriggeredDay[MAX_SCHEDULES] = {0};
int lastTriggeredHour[MAX_SCHEDULES] = {0};
int lastTriggeredMinute[MAX_SCHEDULES] = {0};

// ===== TIMING VARIABLES (NO delay()!) =====
unsigned long lastSensorRead = 0;
unsigned long lastRTCRead = 0;
unsigned long lastBuzzerTime = 0;
unsigned long lastSerialCheck = 0;
unsigned long lastEmergencyFlash = 0;
unsigned long lastWatchdogReset = 0;
bool emergencyActive = false;
int emergencyFlashCount = 0;

// Buzzer state
bool buzzerActive = false;
int buzzerFrequency = 0;
unsigned long buzzerStartTime = 0;
unsigned long buzzerDuration = 0;

// ============================
// Function Prototypes
// ============================
void initSchedules();
void setupWebServer();
void startBuzzer(int frequency, int duration);
bool triggerDispense(int box, int *remainingQuantity = nullptr);
bool reservePillForDispense(int box, String &medicine, int &remainingQuantity);
void emergencyStop();
void updateBuzzer();
void updateEmergencyFlash();
void updateDispensing();
void checkButtons();
void checkSchedule();
void readSensors();
void handleSerialCommands();
void updateWatchdog();
void appendHistory(const char *medicine, int box, const char *status);
void appendNotification(const char *type, const char *message);
// ===== NEW: Cleanup Functions =====
void smartCleanup();
void cleanupNotifications();
void checkHistorySize();
String getMedicationSummary();

// ============================
// WiFi Connection Functions
// ============================

void checkWiFiConnection()
{
    unsigned long currentTime = millis();

    // Check every 10 seconds
    if (currentTime - lastWiFiCheck < 10000)
        return;
    lastWiFiCheck = currentTime;

    if (WiFi.status() != WL_CONNECTED)
    {
        // Only attempt reconnect every 30 seconds to avoid flooding
        if (currentTime - lastWiFiReconnectAttempt < WIFI_RETRY_INTERVAL)
            return;
        lastWiFiReconnectAttempt = currentTime;

        Serial.println("⚠️ WiFi connection lost!");
        Serial.println("🔄 Attempting to reconnect...");

        if (connectToWiFi())
        {
            Serial.println("✅ WiFi reconnected!");
            oledManager.setWiFiStatus(true, WiFi.SSID().c_str());
        }
        else
        {
            Serial.println("❌ WiFi reconnection failed!");
            Serial.println("📡 Still in AP mode - connect to MedGuardian AP");

            // ✅ Ensure AP mode is running (it should be, but just in case)
            if (WiFi.getMode() != WIFI_AP && WiFi.getMode() != WIFI_AP_STA)
            {
                WiFi.softAP("MedGuardian", "12345678");
                Serial.println("📡 AP mode restarted");
            }
        }
    }
}

String getWiFiStatusString()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        return "Connected to " + String(WiFi.SSID()) + " | IP: " + WiFi.localIP().toString();
    }
    else
    {
        return "AP Mode - Connect to MedGuardian";
    }
}

String getWiFiIP()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        return WiFi.localIP().toString();
    }
    else
    {
        return WiFi.softAPIP().toString();
    }
}
bool connectToWiFi()
{
    Serial.printf("📡 Connecting to WiFi: %s\n", WIFI_SSID);

    // ✅ Use AP+STA mode to keep AP running
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    unsigned long startTime = millis();
    int dots = 0;

    while (WiFi.status() != WL_CONNECTED)
    {
        delay(100);
        Serial.print(".");
        dots++;

        if (dots % 10 == 0)
            Serial.println();

        if (millis() - startTime > WIFI_TIMEOUT)
        {
            Serial.println("\n❌ WiFi connection timeout!");
            // ✅ Ensure AP is still running
            if (WiFi.softAPIP().toString() == "0.0.0.0")
            {
                WiFi.softAP("MedGuardian", "12345678");
            }
            return false;
        }
    }

    Serial.println();
    Serial.println("✅ WiFi Connected!");
    Serial.print("📡 IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("📡 RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("📡 SSID: ");
    Serial.println(WiFi.SSID());

    return true;
}

// ============================
// Session Authentication Functions
// ============================

bool checkSession(AsyncWebServerRequest *request)
{
    // Check if session is still valid (timeout)
    if (sessionValid && millis() - sessionStartTime < SESSION_TIMEOUT)
    {
        return true;
    }

    // Check for session cookie
    if (request->hasHeader("Cookie"))
    {
        String cookie = request->header("Cookie");
        if (cookie.indexOf("MG_SESSION=ACTIVE") != -1)
        {
            sessionValid = true;
            sessionStartTime = millis();
            return true;
        }
    }
    return false;
}

// Protected route wrapper
auto requireAuth = [](ArRequestHandlerFunction handler)
{
    return [handler](AsyncWebServerRequest *request)
    {
        if (!checkSession(request))
        {
            request->send(401, "application/json", "{\"error\":\"Unauthorized\"}");
            return;
        }
        handler(request);
    };
};

// ============================
// Schedule Management
// ============================

void initSchedules()
{
    for (int i = 0; i < MAX_SCHEDULES; i++)
    {
        medSchedules[i].year = preferences.getInt(("y" + String(i)).c_str(), 0);
        medSchedules[i].month = preferences.getInt(("M" + String(i)).c_str(), 0);
        medSchedules[i].day = preferences.getInt(("d" + String(i)).c_str(), 0);
        medSchedules[i].hour = preferences.getInt(("h" + String(i)).c_str(), -1);
        medSchedules[i].minute = preferences.getInt(("m" + String(i)).c_str(), -1);
        medSchedules[i].box = preferences.getInt(("b" + String(i)).c_str(), 1);
        medSchedules[i].active = preferences.getBool(("a" + String(i)).c_str(), false);

        if (medSchedules[i].active)
        {
            Serial.printf("📅 Loaded schedule %d: %04d-%02d-%02d %02d:%02d - Box %d\n",
                          i, medSchedules[i].year, medSchedules[i].month, medSchedules[i].day,
                          medSchedules[i].hour, medSchedules[i].minute, medSchedules[i].box);
        }
    }
}

// ============================
// Setup
// ============================
// ============================
// Helper: print free heap (for debugging)
// // ============================
// void printHeap(const char *label)
// {
//     Serial.printf("📊 Heap [%s]: %d bytes free\n", label, ESP.getFreeHeap());
// }

// ============================
// Setup
// ============================
void setup()
{
    Serial.begin(115200);
    printHeap("After Serial");

    Serial.println("\n🏥 MedGuardian Initializing...");

    // Initialize Preferences
    preferences.begin("med-data", false);

    // Setup pins
    pinMode(LED1_PIN, OUTPUT);
    pinMode(LED2_PIN, OUTPUT);
    pinMode(BUTTON1_PIN, INPUT_PULLUP);
    pinMode(BUTTON2_PIN, INPUT_PULLUP);
    pinMode(IR_SENSOR_PIN, INPUT);
    pinMode(BUZZER_PIN, OUTPUT);

    digitalWrite(LED1_PIN, LOW);
    digitalWrite(LED2_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);

    // Initialize DHT
    dht.begin();
    Serial.println("✅ DHT11 Initialized");

    // ---- I2C and OLED ----
    Wire.begin(SDA_PIN, SCL_PIN);
    oledManager.begin();
    printHeap("After OLED");

    // ============================================================
    // RTC DS1302 – COMPLETE BLOCK (comment out for decisive test)
    // ============================================================
    /*
    Serial.println("\n📅 Initializing DS1302 RTC...");
    Rtc.Begin();

    if (!Rtc.IsDateTimeValid()) {
        Serial.println("⚠️ RTC time is invalid, setting compile time...");
        Rtc.SetDateTime(RtcDateTime(__DATE__, __TIME__));
    }

    if (!Rtc.GetIsRunning()) {
        Serial.println("⚠️ RTC was stopped, starting...");
        Rtc.SetIsRunning(true);
    }

    RtcDateTime now = Rtc.GetDateTime();

    // Validate time
    if (Rtc.IsDateTimeValid() &&
        now.Year() >= 2024 && now.Year() <= 2100 &&
        now.Month() >= 1 && now.Month() <= 12 &&
        now.Day() >= 1 && now.Day() <= 31)
    {
        rtcInitialized = true;
        oledManager.setRTC(now);
        Serial.printf("🕐 RTC time: %04d-%02d-%02d %02d:%02d:%02d\n",
                      now.Year(), now.Month(), now.Day(),
                      now.Hour(), now.Minute(), now.Second());
        Serial.println("✅ RTC Initialized");
    }
    else
    {
        rtcInitialized = false;
        Serial.println("❌ RTC still invalid");
    }
    // ============================================================
    */

    // If you uncomment the RTC block, also uncomment the line below.
    // For now, RTC is disabled – set rtcInitialized = false;
    rtcInitialized = false;

    // ---- Servos ----
    servo1.attach(SERVO1_PIN);
    servo2.attach(SERVO2_PIN);
    servo1.write(0);
    servo2.write(0);
    Serial.println("✅ Servos Initialized");

    // ---- LittleFS ----
    if (!LittleFS.begin(true))
    {
        Serial.println("❌ LittleFS Mount Failed!");
        return;
    }
    if (LittleFS.exists("/index.html"))
    {
        Serial.println("✅ index.html found in LittleFS");
    }
    else
    {
        Serial.println("❌ index.html NOT found! Upload web files!");
    }
    Serial.println("✅ LittleFS Mounted");
    printHeap("After LittleFS");

    // ---- SMART cleanup ----
    Serial.println("🧹 Running SMART cleanup...");
    smartCleanup();
    lastCleanupTime = millis();
    printHeap("After smartCleanup");

    // ---- Medication summary ----
    Serial.println("📊 Medication Summary: " + getMedicationSummary());
    printHeap("After getMedicationSummary");

    // ---- Load schedules ----
    initSchedules();
    printHeap("After initSchedules");

    oledManager.setSchedules(medSchedules, MAX_SCHEDULES);
    printHeap("After setSchedules");

    // ============================================================
    // WiFi Setup – MUST be done BEFORE web server
    // ============================================================
    Serial.println("\n📡 Setting up WiFi...");

    if (!WiFi.mode(WIFI_AP_STA))
    {
        Serial.println("❌ Failed to initialize WiFi mode!");
    }
    else
    {
        Serial.println("✅ WiFi mode initialized");
    }

    wifiConnected = connectToWiFi();
    oledManager.setWiFiStatus(wifiConnected, WIFI_SSID);

    // Always start AP mode
    Serial.println("📡 Starting AP mode (always available)...");
    WiFi.softAP("MedGuardian", "12345678");
    Serial.print("📡 AP IP: ");
    Serial.println(WiFi.softAPIP());

    // Print access info
    Serial.println("\n🌐 ACCESS INFORMATION:");
    Serial.println("================================");
    if (wifiConnected)
    {
        Serial.print("📡 Home WiFi IP: ");
        Serial.println(WiFi.localIP());
        Serial.print("📡 SSID: ");
        Serial.println(WiFi.SSID());
        Serial.println("🌐 Access via home WiFi: http://" + WiFi.localIP().toString());
    }
    Serial.println("📡 AP IP: http://" + WiFi.softAPIP().toString());
    Serial.println("📡 AP SSID: MedGuardian");
    Serial.println("🔑 AP Password: 12345678");
    if (wifiConnected)
    {
        Serial.println("✅ Device connected to BOTH home WiFi AND AP mode");
    }
    else
    {
        Serial.println("⚠️ Device in AP mode only (no WiFi connection)");
    }
    Serial.println("================================");

    // ---- Web Server ----
    setupWebServer();
    printHeap("After setupWebServer");

    server.begin();
    Serial.println("✅ Web Server Started");
    printHeap("After server.begin()");

    // ---- Startup beep ----
    startBuzzer(1000, 200);

    // ---- Ready ----
    Serial.println("\n🎯 MedGuardian Ready!");
    if (wifiConnected)
    {
        Serial.printf("🌐 http://%s\n", WiFi.localIP().toString().c_str());
    }
    Serial.printf("🌐 AP IP: http://%s\n", WiFi.softAPIP().toString().c_str());

    if (!rtcInitialized)
    {
        Serial.println("\n⚠️ RTC NOT AVAILABLE – Schedules disabled");
        Serial.println("   Check RTC wiring: DAT=GPIO15, CLK=GPIO19, RST=GPIO5");
    }
}
// ============================
// Non-Blocking Buzzer Control
// ============================
void startBuzzer(int frequency, int duration)
{
    buzzerActive = true;
    buzzerFrequency = frequency;
    buzzerDuration = duration;
    buzzerStartTime = millis();
    tone(BUZZER_PIN, frequency);
}

void updateBuzzer()
{
    if (!buzzerActive)
        return;

    if (millis() - buzzerStartTime >= buzzerDuration)
    {
        noTone(BUZZER_PIN);
        buzzerActive = false;
    }
}

void setupWebServer()
{
    // ===== CORS Headers =====
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

    // ===== Serve web files =====
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *request)
              { request->send(LittleFS, "/index.html", "text/html"); });

    server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request)
              { request->send(LittleFS, "/style.css", "text/css"); });

    server.on("/script.js", HTTP_GET, [](AsyncWebServerRequest *request)
              { request->send(LittleFS, "/script.js", "application/javascript"); });

    // ===== Dispense endpoints =====
    server.on("/dispense1", HTTP_GET, requireAuth([](AsyncWebServerRequest *request)
                                                  {
        int remainingQuantity = -1;
        if (triggerDispense(1, &remainingQuantity)) {
            request->send(200, "application/json", String("{\"status\":\"OK\",\"quantity\":") + String(remainingQuantity) + "}");
            oledManager.onUserInteraction();
        } else {
            request->send(409, "application/json", "{\"error\":\"Dispenser unavailable\"}");
        } }));

    server.on("/dispense2", HTTP_GET, requireAuth([](AsyncWebServerRequest *request)
                                                  {
        int remainingQuantity = -1;
        if (triggerDispense(2, &remainingQuantity)) {
            request->send(200, "application/json", String("{\"status\":\"OK\",\"quantity\":") + String(remainingQuantity) + "}");
            oledManager.onUserInteraction();
        } else {
            request->send(409, "application/json", "{\"error\":\"Dispenser unavailable\"}");
        } }));

    // ===== Sensor data endpoint =====
    server.on("/data", HTTP_GET, [](AsyncWebServerRequest *request)
              {
       String json = "{\"temp\":" + String(temperature) +
              ", \"hum\":" + String(humidity) + "}";
        request->send(200, "application/json", json); });

    // ===== RTC time endpoint =====
    server.on("/time", HTTP_GET, [](AsyncWebServerRequest *request)
              {
        if (rtcInitialized) {
            RtcDateTime now = Rtc.GetDateTime();
            String json = "{\"hour\":" + String(now.Hour()) +
                          ", \"minute\":" + String(now.Minute()) +
                          ", \"second\":" + String(now.Second()) + "}";
            request->send(200, "application/json", json);
        } else {
            request->send(500, "application/json", "{\"error\":\"RTC not available\"}");
        } });

    // ===== Schedule update endpoint =====
    server.on("/updateSchedule", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                        {
        if (request->hasParam("index", true) &&
            request->hasParam("year", true) &&
            request->hasParam("month", true) &&
            request->hasParam("day", true) &&
            request->hasParam("hour", true) &&
            request->hasParam("min", true) &&
            request->hasParam("box", true))
        {
            int index = request->getParam("index", true)->value().toInt();
            int y = request->getParam("year", true)->value().toInt();
            int M = request->getParam("month", true)->value().toInt();
            int d = request->getParam("day", true)->value().toInt();
            int h = request->getParam("hour", true)->value().toInt();
            int m = request->getParam("min", true)->value().toInt();
            int b = request->getParam("box", true)->value().toInt();

            if (index >= 0 && index < MAX_SCHEDULES)
            {
                if (y < 2000 || y > 2100 || M < 1 || M > 12 || d < 1 || d > 31 ||
                    h < 0 || h > 23 || m < 0 || m > 59 || b < 1 || b > 2)
                {
                    request->send(400, "text/plain", "Invalid values");
                    return;
                }

                medSchedules[index] = {y, M, d, h, m, b, true};

                preferences.putInt(("y" + String(index)).c_str(), y);
                preferences.putInt(("M" + String(index)).c_str(), M);
                preferences.putInt(("d" + String(index)).c_str(), d);
                preferences.putInt(("h" + String(index)).c_str(), h);
                preferences.putInt(("m" + String(index)).c_str(), m);
                preferences.putInt(("b" + String(index)).c_str(), b);
                preferences.putBool(("a" + String(index)).c_str(), true);

                request->send(200, "text/plain", "Schedule updated");
                Serial.printf("📅 Schedule %d added: %04d-%02d-%02d %02d:%02d - Box %d\n",
                              index, y, M, d, h, m, b);
                oledManager.onScheduleAdded();   // shows "Next Medication" briefly
            }
            else
            {
                request->send(400, "text/plain", "Invalid index");
            }
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    // ===== Delete schedule endpoint =====
    server.on("/deleteSchedule", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                        {
        if (request->hasParam("index", true))
        {
            int index = request->getParam("index", true)->value().toInt();
            if (index >= 0 && index < MAX_SCHEDULES)
            {
                medSchedules[index].active = false;
                preferences.putBool(("a" + String(index)).c_str(), false);
                request->send(200, "text/plain", "Schedule deleted");
                Serial.printf("🗑️ Schedule %d deleted\n", index);
                oledManager.onUserInteraction();
            }
            else
            {
                request->send(400, "text/plain", "Invalid index");
            }
        }
        else
        {
            request->send(400, "text/plain", "Missing index");
        } }));

    // ===== Emergency stop endpoint =====
    server.on("/emergencyStop", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                       {
        emergencyStop();
        request->send(200, "text/plain", "Emergency stop activated"); }));

    // ===== GET SCHEDULES endpoint =====
    server.on("/getSchedules", HTTP_GET, [](AsyncWebServerRequest *request)
              {
        String json = "[";
        int count = 0;
        for (int i = 0; i < MAX_SCHEDULES; i++)
        {
            if (medSchedules[i].active)
            {
                if (count > 0)
                    json += ",";
                json += "{\"index\":" + String(i) +
                        ",\"year\":" + String(medSchedules[i].year) +
                        ",\"month\":" + String(medSchedules[i].month) +
                        ",\"day\":" + String(medSchedules[i].day) +
                        ",\"hour\":" + String(medSchedules[i].hour) +
                        ",\"minute\":" + String(medSchedules[i].minute) +
                        ",\"box\":" + String(medSchedules[i].box) + "}";
                count++;
            }
        }
        json += "]";
        request->send(200, "application/json", json); });

    // ===== SET TIME endpoint =====
    server.on("/setTime", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                 {
        if (!rtcInitialized)
        {
            request->send(500, "text/plain", "RTC not available");
            return;
        }

        if (request->hasParam("year", true) &&
            request->hasParam("month", true) &&
            request->hasParam("day", true) &&
            request->hasParam("hour", true) &&
            request->hasParam("minute", true) &&
            request->hasParam("second", true))
        {
            int y = request->getParam("year", true)->value().toInt();
            int M = request->getParam("month", true)->value().toInt();
            int d = request->getParam("day", true)->value().toInt();
            int h = request->getParam("hour", true)->value().toInt();
            int m = request->getParam("minute", true)->value().toInt();
            int s = request->getParam("second", true)->value().toInt();

            if (y < 2000 || y > 2100 || M < 1 || M > 12 || d < 1 || d > 31 ||
                h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59)
            {
                request->send(400, "text/plain", "Invalid date/time values");
                return;
            }

            Rtc.SetDateTime(RtcDateTime(y, M, d, h, m, s));
            request->send(200, "text/plain", "Time set successfully");
            Serial.printf("🕐 RTC manually set to: %04d-%02d-%02d %02d:%02d:%02d\n",
                          y, M, d, h, m, s);
            oledManager.onUserInteraction(); // <-- add this
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    // ===== Activate/Deactivate Dispenser =====
    server.on("/activateDispenser", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                           {
        if (request->hasParam("id", true) && request->hasParam("active", true))
        {
            int id = request->getParam("id", true)->value().toInt();
            bool active = request->getParam("active", true)->value() == "true";

            preferences.putBool(("disp_active_" + String(id)).c_str(), active);

            Serial.printf("📦 Dispenser %d %s\n", id, active ? "activated" : "deactivated");
            request->send(200, "text/plain", "OK");
            oledManager.onUserInteraction(); // <-- add this
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    // ===== Save Medicine Configuration =====
    server.on("/saveMedicine", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                      {
        if (request->hasParam("id", true) &&
            request->hasParam("medicine", true) &&
            request->hasParam("quantity", true))
        {
            int id = request->getParam("id", true)->value().toInt();
            String medicine = request->getParam("medicine", true)->value();
            int quantity = request->getParam("quantity", true)->value().toInt();

            preferences.putString(("med_name_" + String(id)).c_str(), medicine);
            preferences.putInt(("med_qty_" + String(id)).c_str(), quantity);

            Serial.printf("💊 Dispenser %d: %s (%d pills)\n", id, medicine.c_str(), quantity);
            request->send(200, "text/plain", "OK");
            oledManager.onUserInteraction(); // <-- add this
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    // ===== Update Medicine Quantity =====
    server.on("/updateQuantity", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                        {
        if (request->hasParam("id", true) &&
            request->hasParam("quantity", true) &&
            request->hasParam("medicine", true))
        {
            int id = request->getParam("id", true)->value().toInt();
            int quantity = request->getParam("quantity", true)->value().toInt();
            String medicine = request->getParam("medicine", true)->value();

            preferences.putInt(("med_qty_" + String(id)).c_str(), quantity);
            preferences.putString(("med_name_" + String(id)).c_str(), medicine);

            Serial.printf("📊 Dispenser %d updated: %s (%d remaining)\n", id, medicine.c_str(), quantity);
            request->send(200, "text/plain", "OK");
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    // ===== Get Medicine Configuration =====
    server.on("/getMedicineConfig", HTTP_GET, [](AsyncWebServerRequest *request)
              {
        String json = "[";
        int count = 0;
        for (int id = 1; id <= 2; id++)
        {
            String key = "disp_active_" + String(id);
            bool active = preferences.getBool(key.c_str(), false);

            if (active)
            {
                if (count > 0)
                    json += ",";
                String name = preferences.getString(("med_name_" + String(id)).c_str(), "");
                int qty = preferences.getInt(("med_qty_" + String(id)).c_str(), 0);

                json += "{\"id\":" + String(id) +
                        ",\"active\":true" +
                        ",\"medicine\":\"" + name + "\"" +
                        ",\"quantity\":" + String(qty) + "}";
                count++;
            }
        }
        json += "]";
        request->send(200, "application/json", json); });

    // ===== CONFIGURATION ENDPOINT =====
    server.on("/getConfig", HTTP_GET, requireAuth([](AsyncWebServerRequest *request)
                                                  {
    String json = "{";
    for (int id = 1; id <= 2; id++) {
        if (id > 1) json += ",";
        json += "\"" + String(id) + "\":{";
        json += "\"active\":" + String(preferences.getBool(("disp_active_" + String(id)).c_str(), false) ? "true" : "false") + ",";
        json += "\"medicine\":\"" + preferences.getString(("med_name_" + String(id)).c_str(), "") + "\",";
        json += "\"quantity\":" + String(preferences.getInt(("med_qty_" + String(id)).c_str(), 0));
        json += "}";
    }
    json += "}";
    request->send(200, "application/json", json); }));

    // ===== HISTORY ENDPOINTS =====
    server.on("/history", HTTP_GET, [](AsyncWebServerRequest *request)
              { request->send(200, "application/json", getHistoryJson()); });

    server.on("/history", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                 {
        if (request->hasParam("medicine", true) &&
            request->hasParam("box", true) &&
            request->hasParam("status", true))
        {
            String medicine = request->getParam("medicine", true)->value();
            int box = request->getParam("box", true)->value().toInt();
            String status = request->getParam("status", true)->value();
            appendHistory(medicine.c_str(), box, status.c_str());
            request->send(200, "text/plain", "OK");
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    server.on("/history/clear", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                       {
        writeFile(LittleFS, HISTORY_FILE, "[]");
        request->send(200, "text/plain", "History cleared"); }));

    // ===== NOTIFICATION ENDPOINTS =====
    server.on("/notifications", HTTP_GET, [](AsyncWebServerRequest *request)
              { request->send(200, "application/json", getNotificationsJson()); });

    server.on("/notifications", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                       {
        if (request->hasParam("type", true) && request->hasParam("message", true))
        {
            String type = request->getParam("type", true)->value();
            String message = request->getParam("message", true)->value();
            appendNotification(type.c_str(), message.c_str());
            request->send(200, "text/plain", "OK");
        }
        else
        {
            request->send(400, "text/plain", "Missing parameters");
        } }));

    server.on("/notifications/clear", HTTP_POST, requireAuth([](AsyncWebServerRequest *request)
                                                             {
        writeFile(LittleFS, NOTIFICATIONS_FILE, "[]");
        request->send(200, "text/plain", "Notifications cleared"); }));

    // ===== NEW: Medication Summary Endpoint =====
    server.on("/history/summary", HTTP_GET, [](AsyncWebServerRequest *request)
              { request->send(200, "application/json", getMedicationSummary()); });

    // ===== LOGIN ENDPOINT =====
    server.on("/login", HTTP_POST, [](AsyncWebServerRequest *request)
              {
        if (request->hasParam("pin", true))
        {
            String pin = request->getParam("pin", true)->value();
            if (pin == ADMIN_PIN)
            {
                sessionValid = true;
                sessionStartTime = millis();
                AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", "OK");
                response->addHeader("Set-Cookie", "MG_SESSION=ACTIVE; Max-Age=3600; Path=/");
                request->send(response);
                Serial.println("✅ User logged in");
                // after sessionValid = true;
                oledManager.onUserInteraction();
                return;
            }
        }
        request->send(401, "text/plain", "Invalid PIN"); });

    // ===== LOGOUT ENDPOINT =====
    server.on("/logout", HTTP_POST, [](AsyncWebServerRequest *request)
              {
        sessionValid = false;
        AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", "OK");
        response->addHeader("Set-Cookie", "MG_SESSION=; Max-Age=0; Path=/");
        request->send(response);
        Serial.println("👋 User logged out"); });

    // ===== ✅ WiFi Status Endpoint =====
    server.on("/wifi/status", HTTP_GET, [](AsyncWebServerRequest *request)
              {
        String json = "{";
        json += "\"connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
        json += "\"ssid\":\"" + WiFi.SSID() + "\",";
        json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
        json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
        json += "\"ap_ip\":\"" + WiFi.softAPIP().toString() + "\"";
        json += "}";
        request->send(200, "application/json", json); });

    // ============================================
    // ✅ 404 Not Found handler - MUST BE ABSOLUTELY LAST!
    // ============================================
    server.onNotFound([](AsyncWebServerRequest *request)
                      {
        Serial.print("❌ Route not found: ");
        Serial.println(request->url());

        if (LittleFS.exists(request->url()))
        {
            request->send(LittleFS, request->url());
        }
        else
        {
            String html = "<!DOCTYPE html><html><head><title>MedGuardian</title>";
            html += "<style>body{font-family:Arial;text-align:center;padding:50px;background:#f4f8fb;}</style>";
            html += "</head><body>";
            html += "<h1>🏥 MedGuardian</h1>";
            html += "<p>❌ Page not found: " + String(request->url()) + "</p>";
            html += "<p><a href='/'>Go to Dashboard</a></p>";
            html += "</body></html>";
            request->send(404, "text/html", html);
        } });
}

// ============================
// Emergency Stop (Non-Blocking)
// ============================
void emergencyStop()
{
    // Stop all dispensing
    if (isDispensing1)
    {
        servo1.write(0);
        digitalWrite(LED1_PIN, LOW);
        isDispensing1 = false;
    }
    if (isDispensing2)
    {
        servo2.write(0);
        digitalWrite(LED2_PIN, LOW);
        isDispensing2 = false;
    }

    emergencyActive = true;
    emergencyFlashCount = 0;
    lastEmergencyFlash = millis();

    // Sound alarm (non-blocking)
    startBuzzer(2000, 300);

    Serial.println("⚠️ EMERGENCY STOP ACTIVATED!");
}

void updateEmergencyFlash()
{
    if (!emergencyActive)
        return;

    unsigned long currentTime = millis();

    if (currentTime - lastEmergencyFlash >= 200)
    {
        lastEmergencyFlash = currentTime;
        emergencyFlashCount++;

        // Toggle LEDs
        bool state = (emergencyFlashCount % 2 == 1);
        digitalWrite(LED1_PIN, state);
        digitalWrite(LED2_PIN, state);

        // Stop after 6 flashes (1.2 seconds)
        if (emergencyFlashCount >= 6)
        {
            emergencyActive = false;
            digitalWrite(LED1_PIN, LOW);
            digitalWrite(LED2_PIN, LOW);
        }
    }
}

// ============================
// Dispensing Logic
// ============================
bool reservePillForDispense(int box, String &medicine, int &remainingQuantity)
{
    if (box < 1 || box > 2)
    {
        return false;
    }

    String activeKey = "disp_active_" + String(box);
    String nameKey = "med_name_" + String(box);
    String quantityKey = "med_qty_" + String(box);
    String defaultName = String("Box ") + String(box);

    bool active = preferences.getBool(activeKey.c_str(), false);
    medicine = preferences.getString(nameKey.c_str(), defaultName);
    int currentQuantity = preferences.getInt(quantityKey.c_str(), 0);

    if (!active)
    {
        String message = String("Box ") + String(box) + " is inactive; dispense blocked";
        appendNotification("warning", message.c_str());
        Serial.println(message);
        return false;
    }

    if (currentQuantity <= 0)
    {
        String message = medicine + " is empty; dispense blocked";
        appendNotification("warning", message.c_str());
        Serial.println(message);
        return false;
    }

    remainingQuantity = currentQuantity - 1;
    preferences.putInt(quantityKey.c_str(), remainingQuantity);
    return true;
}

bool triggerDispense(int box, int *remainingQuantity)
{

    Serial.println("triggerDispense() called");

    if (emergencyActive)
        return false;

    if ((box == 1 && isDispensing1) || (box == 2 && isDispensing2))
    {
        Serial.printf("Box %d is already dispensing\n", box);
        return false;
    }

    String medicine = "";
    int remaining = 0;
    if (!reservePillForDispense(box, medicine, remaining))
    {
        return false;
    }

    if (remainingQuantity != nullptr)
    {
        *remainingQuantity = remaining;
    }

    if (box == 1 && !isDispensing1)
    {
        medicine = preferences.getString("med_name_1", "Box 1");
        digitalWrite(LED1_PIN, HIGH);
        servo1.write(90);
        startTime1 = millis();
        isDispensing1 = true;
        Serial.println("💊 Dispensing Box 1");
        startBuzzer(800, 100);

        // ✅ Auto-log history
        appendHistory(medicine.c_str(), 1, "Dispensed");
        appendNotification("success", (medicine + " dispensed from Box 1").c_str());
    }
    else if (box == 2 && !isDispensing2)
    {
        medicine = preferences.getString("med_name_2", "Box 2");
        digitalWrite(LED2_PIN, HIGH);
        servo2.write(90);
        startTime2 = millis();
        isDispensing2 = true;
        Serial.println("💊 Dispensing Box 2");
        startBuzzer(800, 100);

        // ✅ Auto-log history
        appendHistory(medicine.c_str(), 2, "Dispensed");
        appendNotification("success", (medicine + " dispensed from Box 2").c_str());
    }
    else
    {
        return false;
    }

    return true;
}

void updateDispensing()
{
    unsigned long currentTime = millis();

    if (isDispensing1 && (currentTime - startTime1 >= DISPENSE_TIME))
    {
        servo1.write(0);
        digitalWrite(LED1_PIN, LOW);
        isDispensing1 = false;
        Serial.println("✅ Box 1 dispense complete");
        oledManager.onDispenseComplete();
        startBuzzer(1200, 50);

        // ✅ Log success
        appendNotification("success", "Box 1 dispense complete");
    }

    if (isDispensing2 && (currentTime - startTime2 >= DISPENSE_TIME))
    {
        servo2.write(0);
        digitalWrite(LED2_PIN, LOW);
        isDispensing2 = false;
        Serial.println("✅ Box 2 dispense complete");
        oledManager.onDispenseComplete();
        startBuzzer(1200, 50);

        // ✅ Log success
        appendNotification("success", "Box 2 dispense complete");
    }
}

// ============================
// Button Handling (Non-Blocking)
// ============================
void checkButtons()
{
    unsigned long currentTime = millis();

    if (currentTime - lastButtonTime < DEBOUNCE_TIME)
        return;

    if (digitalRead(BUTTON1_PIN) == LOW)
    {
        triggerDispense(1);
        oledManager.onUserInteraction();
        lastButtonTime = currentTime;
    }
    else if (digitalRead(BUTTON2_PIN) == LOW)
    {
        triggerDispense(2);
        oledManager.onUserInteraction();
        lastButtonTime = currentTime;
    }
}

// ============================
// Schedule Management
// ============================
void checkSchedule()
{

    // ✅ Check if RTC is available
    if (!rtcInitialized)
        return;

    // Read RTC without blocking
    RtcDateTime now = Rtc.GetDateTime();

    for (int i = 0; i < MAX_SCHEDULES; i++)
    {
        if (medSchedules[i].active &&
            now.Year() == medSchedules[i].year &&
            now.Month() == medSchedules[i].month &&
            now.Day() == medSchedules[i].day &&
            now.Hour() == medSchedules[i].hour &&
            now.Minute() == medSchedules[i].minute)
        {

            bool alreadyTriggered =
                lastTriggeredYear[i] == now.Year() &&
                lastTriggeredMonth[i] == now.Month() &&
                lastTriggeredDay[i] == now.Day() &&
                lastTriggeredHour[i] == now.Hour() &&
                lastTriggeredMinute[i] == now.Minute();

            if (!alreadyTriggered)
            {
                // Get medicine name from Preferences
                static char medBuf[32];
                String medName = preferences.getString(("med_name_" + String(medSchedules[i].box)).c_str(), "Box " + String(medSchedules[i].box));
                medName.toCharArray(medBuf, sizeof(medBuf));
                oledManager.triggerReminder(medSchedules[i].box, medBuf);
                triggerDispense(medSchedules[i].box);
                lastTriggeredYear[i] = now.Year();
                lastTriggeredMonth[i] = now.Month();
                lastTriggeredDay[i] = now.Day();
                lastTriggeredHour[i] = now.Hour();
                lastTriggeredMinute[i] = now.Minute();
                Serial.printf("⏰ Schedule %d triggered at %04d-%02d-%02d %02d:%02d\n",
                              i, now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute());
            }
        }
    }
}

// ============================
// Sensor Reading (Non-Blocking)
// ============================
void readSensors()
{
    unsigned long currentTime = millis();

    if (currentTime - lastSensorRead < SENSOR_READ_INTERVAL)
        return;
    lastSensorRead = currentTime;

    // Read DHT22
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();

    if (!isnan(temp) && !isnan(hum))
    {
        temperature = temp;
        humidity = hum;
        oledManager.setEnvironmentData(temperature, humidity);
        if (rtcInitialized)
        {
            oledManager.setRTC(Rtc.GetDateTime());
        }
    }
    else
    {
        Serial.println("⚠️ Failed to read DHT22!");
    }

    // // Read HX711 (non-blocking)
    // if (scale.is_ready())
    // {
    //     float rawWeight = scale.get_units(5);
    //     if (!isnan(rawWeight))
    //     {
    //         weight = rawWeight / 1000.0; // Convert to kg

    //         // Detect IR beam break
    //         bool beamBroken = digitalRead(IR_SENSOR_PIN) == LOW;

    //         // Check cup status
    //         if (weight < (EMPTY_CUP_WEIGHT - WEIGHT_THRESHOLD))
    //         {
    //             if (beamBroken)
    //             {
    //                 Serial.println("🔴 Cup Removed!");
    //             }
    //         }
    //         else if (weight > (EMPTY_CUP_WEIGHT + WEIGHT_THRESHOLD))
    //         {
    //             Serial.printf("💊 Cup Present - Weight: %.2fg\n", weight * 1000);
    //         }
    //         else
    //         {
    //             Serial.println("⚪ Cup Present - Empty");
    //         }
    //     }
    // }
    // else
    // {
    //     Serial.println("⚠️ Failed to read HX711!");
    // }

    // === Alerts for OLED ===
    char detailBuf[16];
    if (temperature > 40.0)
    {
        snprintf(detailBuf, sizeof(detailBuf), "%.1f°C", temperature);
        oledManager.triggerAlert("Too Hot", detailBuf);
    }
    else if (humidity > 80.0)
    {
        snprintf(detailBuf, sizeof(detailBuf), "%.1f%%", humidity);
        oledManager.triggerAlert("Humidity High", detailBuf);
    }
    // else if (weight < 0.05 && digitalRead(IR_SENSOR_PIN) == LOW)
    // {
    //     oledManager.triggerAlert("Cup Removed", "Check cup");
    // }
    // else if (scale.is_ready() == false)
    // {
    //     oledManager.triggerAlert("Sensor Error", "HX711 failed");
    // }
    else
    {
        // No alert – clear it to return to normal display
        oledManager.clearAlert();
    }
}

// ============================
// Serial Command Handler (Non-Blocking)
// ============================
void handleSerialCommands()
{
    unsigned long currentTime = millis();
    if (currentTime - lastSerialCheck < 100)
        return; // Check every 100ms
    lastSerialCheck = currentTime;

    if (Serial.available())
    {
        char c = Serial.read();
        switch (c)
        {
        case '1':
            triggerDispense(1);
            break;
        case '2':
            triggerDispense(2);
            break;
        case 's':
        {
            // ✅ Check if RTC is available
            if (rtcInitialized)
            {
                RtcDateTime now = Rtc.GetDateTime();
                Serial.printf("🕐 RTC: %02d:%02d:%02d\n", now.Hour(), now.Minute(), now.Second());
            }
            else
            {
                Serial.println("❌ RTC not available!");
            }
            break;
        }
        case 'e':
            emergencyStop();
            break;
        case 'r':
        {
            // ✅ Check if RTC is available
            if (rtcInitialized)
            {
                Rtc.SetDateTime(RtcDateTime(__DATE__, __TIME__));
                Serial.println("✅ RTC reset to compile time");
            }
            else
            {
                Serial.println("❌ RTC not available!");
            }
            break;
        }
        default:
            Serial.println("Commands: 1=Box1, 2=Box2, s=Status, e=Emergency, r=ResetRTC");
            break;
        }
    }
}

// ============================
// Watchdog Reset (Prevents WDT timeout)
// ============================
void updateWatchdog()
{
    unsigned long currentTime = millis();
    if (currentTime - lastWatchdogReset >= WATCHDOG_RESET_INTERVAL)
    {
        lastWatchdogReset = currentTime;
        // Feed the watchdog if enabled
        // esp_task_wdt_reset();  // Uncomment if using watchdog
    }
}

// ============================
// Helper Functions for JSON Files
// ============================

String readFile(fs::FS &fs, const char *path)
{
    File file = fs.open(path, "r");
    if (!file || file.isDirectory())
    {
        return "[]"; // Return empty array if file doesn't exist
    }
    String content = file.readString();
    file.close();
    return content;
}

void writeFile(fs::FS &fs, const char *path, const char *content)
{
    File file = fs.open(path, "w");
    if (!file)
    {
        Serial.printf("❌ Failed to open %s for writing\n", path);
        return;
    }
    file.print(content);
    file.close();
}

// ============================
// History Functions - PERMANENT STORAGE
// ============================

void appendHistory(const char *medicine, int box, const char *status)
{
    // Get current time
    String timeStr = "Unknown";
    if (rtcInitialized)
    {
        RtcDateTime now = Rtc.GetDateTime();
        char buffer[30];
        sprintf(buffer, "%04d-%02d-%02d %02d:%02d:%02d",
                now.Year(), now.Month(), now.Day(),
                now.Hour(), now.Minute(), now.Second());
        timeStr = String(buffer);
    }

    // Read existing history
    String historyJson = readFile(LittleFS, HISTORY_FILE);
    DynamicJsonDocument doc(8192);
    DeserializationError error = deserializeJson(doc, historyJson);

    JsonArray historyArray;
    if (error || !doc.is<JsonArray>())
    {
        historyArray = doc.to<JsonArray>();
    }
    else
    {
        historyArray = doc.as<JsonArray>();
    }

    // ✅ Create detailed medication record with type
    JsonObject entry = historyArray.createNestedObject();
    entry["time"] = timeStr;
    entry["medicine"] = medicine;
    entry["box"] = box;
    entry["status"] = status;

    // Add type for better filtering
    if (strcmp(status, "Dispensed") == 0 || strcmp(status, "Success") == 0)
    {
        entry["type"] = "dispensed";
        entry["description"] = String(medicine) + " dispensed from Box " + String(box);
    }
    else if (strcmp(status, "Missed") == 0 || strcmp(status, "Failed") == 0)
    {
        entry["type"] = "missed";
        entry["description"] = String(medicine) + " was NOT taken (missed dose)";
    }
    else if (strcmp(status, "Refilled") == 0)
    {
        entry["type"] = "refill";
        entry["description"] = String(medicine) + " refilled (new supply)";
    }
    else if (strcmp(status, "Configured") == 0)
    {
        entry["type"] = "configured";
        entry["description"] = String(medicine) + " configured for Box " + String(box);
    }
    else if (strcmp(status, "EMERGENCY") == 0)
    {
        entry["type"] = "emergency";
        entry["description"] = "EMERGENCY STOP activated";
    }
    else
    {
        entry["type"] = "other";
        entry["description"] = String(medicine) + " - " + String(status);
    }

    // ✅ Keep only last MAX_HISTORY_ENTRIES (never delete medication records by age)
    while (historyArray.size() > MAX_HISTORY_ENTRIES)
    {
        // Remove oldest entries only if we exceed max
        // But keep all medication records (dispensed/missed) even if old
        JsonObject oldest = historyArray[0];
        String type = oldest["type"] | "";

        // If it's a medication record, try to keep it
        if (type == "dispensed" || type == "missed" || type == "refill")
        {
            // Keep it - increase limit if needed
            // For now, just keep by increasing MAX_HISTORY_ENTRIES
        }

        historyArray.remove(0);
    }

    // Write back to file
    String output;
    serializeJson(doc, output);
    writeFile(LittleFS, HISTORY_FILE, output.c_str());

    Serial.printf("📝 History: %s - Box %d - %s\n", medicine, box, status);
}

String getHistoryJson()
{
    return readFile(LittleFS, HISTORY_FILE);
}

// ============================
// Notification Functions - TEMPORARY STORAGE
// ============================

void appendNotification(const char *type, const char *message)
{
    String notifJson = readFile(LittleFS, NOTIFICATIONS_FILE);
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, notifJson);
    JsonArray notifArray;

    if (error || !doc.is<JsonArray>())
    {
        notifArray = doc.to<JsonArray>();
    }
    else
    {
        notifArray = doc.as<JsonArray>();
    }

    // Get current time
    String timeStr = "Unknown";
    if (rtcInitialized)
    {
        RtcDateTime now = Rtc.GetDateTime();
        char buffer[6];
        sprintf(buffer, "%02d:%02d", now.Hour(), now.Minute());
        timeStr = String(buffer);
    }

    JsonObject entry = notifArray.createNestedObject();
    entry["type"] = type;
    entry["message"] = message;
    entry["time"] = timeStr;

    // Keep only last MAX_NOTIFICATIONS
    while (notifArray.size() > MAX_NOTIFICATIONS)
    {
        notifArray.remove(0);
    }

    String output;
    serializeJson(doc, output);
    writeFile(LittleFS, NOTIFICATIONS_FILE, output.c_str());

    Serial.printf("🔔 Notification: [%s] %s\n", type, message);
}

String getNotificationsJson()
{
    return readFile(LittleFS, NOTIFICATIONS_FILE);
}

// ============================
// SMART CLEANUP - Keeps Medication Data
// ============================

void smartCleanup()
{
    Serial.println("🧹 Running SMART cleanup...");
    Serial.println("   ✅ Keeping ALL medication history");
    Serial.println("   ✅ Keeping ALL dispensed/missed records");
    Serial.println("   🗑️ Cleaning old notifications only");

    // ✅ Clean notifications (temporary)
    cleanupNotifications();

    // ✅ Check history size and warn if too large
    checkHistorySize();
}
void cleanupNotifications()
{
    Serial.println("🧹 Cleaning notifications (temporary data)...");

    String notifJson = readFile(LittleFS, NOTIFICATIONS_FILE);
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, notifJson);

    if (error)
    {
        Serial.printf("❌ Failed to parse notifications: %s\n", error.c_str());
        return;
    }

    JsonArray notifArray;
    if (!doc.is<JsonArray>())
    {
        notifArray = doc.to<JsonArray>();
    }
    else
    {
        notifArray = doc.as<JsonArray>();
    }

    int removedCount = 0;
    int keptCount = 0;

    if (rtcInitialized)
    {
        RtcDateTime now = Rtc.GetDateTime();
        uint32_t nowTime = now.Unix32Time();

        for (int i = notifArray.size() - 1; i >= 0; i--)
        {
            JsonObject entry = notifArray[i];
            if (!entry)
                continue;

            String timeStr = entry["time"] | "Unknown";

            // Parse time (HH:MM)
            if (timeStr != "Unknown" && timeStr.length() >= 5)
            {
                int hour = timeStr.substring(0, 2).toInt();
                int minute = timeStr.substring(3, 5).toInt();

                RtcDateTime notifTime(
                    now.Year(),
                    now.Month(),
                    now.Day(),
                    hour,
                    minute,
                    0);

                uint32_t notifUnix = notifTime.Unix32Time();

                // If notification appears to be in the future,
                // assume it was from yesterday.
                if (notifUnix > nowTime)
                {
                    notifUnix -= 86400UL;
                }

                uint32_t ageDays = (nowTime - notifUnix) / 86400UL;

                if (ageDays > NOTIFICATION_RETENTION_DAYS)
                {
                    notifArray.remove(i);
                    removedCount++;
                }
                else
                {
                    keptCount++;
                }
            }
            else
            {
                keptCount++;
            }
        }
    }

    // Keep only the latest notifications
    while (notifArray.size() > MAX_NOTIFICATIONS)
    {
        notifArray.remove(0);
        removedCount++;
    }

    if (removedCount > 0)
    {
        String output;
        serializeJson(doc, output);
        writeFile(LittleFS, NOTIFICATIONS_FILE, output.c_str());

        Serial.printf(
            "✅ Removed %d old notifications (kept %d)\n",
            removedCount,
            notifArray.size());
    }
    else
    {
        Serial.printf(
            "✅ Notifications: %d entries, no cleanup needed\n",
            notifArray.size());
    }
}

void checkHistorySize()
{
    String historyJson = readFile(LittleFS, HISTORY_FILE);
    DynamicJsonDocument doc(8192);
    DeserializationError error = deserializeJson(doc, historyJson);

    if (error || !doc.is<JsonArray>())
        return;

    JsonArray historyArray = doc.as<JsonArray>();
    int size = historyArray.size();

    Serial.printf("📊 Medication History: %d records\n", size);

    // Count by type
    int dispensed = 0, missed = 0, refills = 0, others = 0;
    for (JsonObject entry : historyArray)
    {
        String type = entry["type"] | "other";
        if (type == "dispensed")
            dispensed++;
        else if (type == "missed")
            missed++;
        else if (type == "refill")
            refills++;
        else
            others++;
    }

    Serial.printf("   ✅ Dispensed: %d\n", dispensed);
    Serial.printf("   ❌ Missed: %d\n", missed);
    Serial.printf("   🔄 Refills: %d\n", refills);
    Serial.printf("   📝 Other: %d\n", others);

    // Warn if history is getting too large
    if (size > 500)
    {
        Serial.println("⚠️ History is getting large (>500 records)");
        Serial.println("   Consider archiving or exporting old records");
    }
}

String getMedicationSummary()
{
    String historyJson = readFile(LittleFS, HISTORY_FILE);
    DynamicJsonDocument doc(8192);
    DeserializationError error = deserializeJson(doc, historyJson);

    if (error || !doc.is<JsonArray>())
    {
        return "{\"error\":\"No history data\"}";
    }

    JsonArray historyArray = doc.as<JsonArray>();

    int totalDispensed = 0;
    int totalMissed = 0;
    int totalRefills = 0;

    for (JsonObject entry : historyArray)
    {
        String type = entry["type"] | "";
        if (type == "dispensed")
            totalDispensed++;
        else if (type == "missed")
            totalMissed++;
        else if (type == "refill")
            totalRefills++;
    }

    String json = "{";
    json += "\"total_dispensed\":" + String(totalDispensed) + ",";
    json += "\"total_missed\":" + String(totalMissed) + ",";
    json += "\"total_refills\":" + String(totalRefills) + ",";
    json += "\"total_records\":" + String(historyArray.size());
    json += "}";

    return json;
}

// ============================
// Main Loop (Completely Non-Blocking)
// ============================
void loop()
{
    oledManager.update();
    // All functions are non-blocking and use millis() timers
    checkButtons();
    updateDispensing();
    updateBuzzer();
    updateEmergencyFlash();
    checkSchedule();
    readSensors();
    handleSerialCommands();
    updateWatchdog();

    // ✅ ADD THIS - Check WiFi connection
    checkWiFiConnection();

    // ✅ Run smart cleanup daily (keeps medication data, cleans notifications)
    unsigned long currentTime = millis(); // ← Declare ONCE
    if (currentTime - lastCleanupTime >= CLEANUP_INTERVAL)
    {
        lastCleanupTime = currentTime;
        Serial.println("🔄 Running scheduled smart cleanup...");
        smartCleanup();
    }

    // ✅ Non-blocking WiFi status LED with state patterns
    static unsigned long lastWiFiBlink = 0;
    static bool wifiLedState = false;
    static int blinkCount = 0;
    // ← REMOVE: unsigned long currentTime = millis(); (use the existing one)

    // Different blink intervals based on WiFi state
    unsigned long blinkInterval;
    if (WiFi.status() == WL_CONNECTED)
    {
        blinkInterval = 2000; // Connected: blink every 2 seconds
    }
    else if (WiFi.status() == WL_IDLE_STATUS || WiFi.status() == WL_DISCONNECTED)
    {
        blinkInterval = 500; // Disconnected: fast blink
    }
    else
    {
        blinkInterval = 1000; // Connecting: medium blink
    }

    if (currentTime - lastWiFiBlink >= blinkInterval)
    { // ← Use existing currentTime
        lastWiFiBlink = currentTime;
        wifiLedState = !wifiLedState;
        digitalWrite(LED_BUILTIN, wifiLedState);
    }

    // Small delay prevents watchdog issues
    delay(1);
}
