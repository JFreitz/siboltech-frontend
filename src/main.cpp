#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_BME280.h>

static const uint32_t BAUD = 115200;
static const char* DEVICE_ID = "esp32-wroom32";

// --- WiFi Configuration ---
static const char* WIFI_SSID = "JP";
static const char* WIFI_PASSWORD = "qwertyuiopa";

// --- MQTT Configuration (HiveMQ Cloud Free Tier) ---
// Sign up at: https://www.hivemq.com/mqtt-cloud-broker/
// Create a cluster, then create credentials (username/password)


// --- Cloud API Configuration (for sensor data upload) ---
// Use LOCAL RPi IP for fast sensor uploads, relay polling stays on local network
static const char* API_BASE_URL = "http://172.20.10.2:5000";  // Local RPi - much faster!
static const char* API_KEY = "espkey123";
static uint32_t last_sensor_upload_ms = 0;
static const uint32_t SENSOR_UPLOAD_INTERVAL = 2000;  // Upload every 2 seconds (fast local network)
static uint32_t last_relay_poll_ms = 0;
static const uint32_t RELAY_POLL_INTERVAL = 50;  // Poll every 50ms for faster response
static bool wifi_connected = false;

// --- 9-Channel Relay Module ---
// Relay 1-8: GPIO 12-19, Relay 9: GPIO 23 (Leafy Green)
static const int RELAY_PINS[] = {12, 13, 14, 15, 16, 17, 18, 19, 23};
static const int NUM_RELAYS = 9;
static bool relay_states[NUM_RELAYS] = {false};
static String serial_buffer = "";

// --- Sensors ---
static const int TDS_PIN = 34;
static const float ADC_VREF = 3.3f;
static const int ADC_MAX = 4095;
static const float TDS_FACTOR = 0.5f;
static const int PH_PIN = 35;
static const int DO_PIN = 32;
static const int I2C_SDA = 21;
static const int I2C_SCL = 22;
static uint32_t last_print_ms = 0;

static Adafruit_BME280 bme;
static bool bme_ok = false;

static bool init_bme() {
  Serial.println("Initializing BME280...");
  delay(100);  // Give sensor time to stabilize
  
  // Try address 0x76 first
  if (bme.begin(0x76)) {
    Serial.println("✓ BME280 found at address 0x76");
    return true;
  }
  Serial.println("✗ Not found at 0x76, trying 0x77...");
  delay(50);
  
  // Try address 0x77
  if (bme.begin(0x77)) {
    Serial.println("✓ BME280 found at address 0x77");
    return true;
  }
  Serial.println("✗ BME280 NOT FOUND at either address!");
  Serial.println("  Check: I2C wiring (SDA=GPIO21, SCL=GPIO22), pull-up resistors, sensor power");
  return false;
}

// --- Relay Control Functions ---
void setRelay(int relayNum, bool on) {
  if (relayNum < 1 || relayNum > NUM_RELAYS) return;
  int idx = relayNum - 1;
  relay_states[idx] = on;
  digitalWrite(RELAY_PINS[idx], on ? LOW : HIGH);  // Active-LOW
  Serial.printf("{\"relay\":%d,\"state\":\"%s\"}\n", relayNum, on ? "ON" : "OFF");
}

void setAllRelays(bool on) {
  for (int i = 0; i < NUM_RELAYS; i++) {
    relay_states[i] = on;
    digitalWrite(RELAY_PINS[i], on ? LOW : HIGH);
  }
  Serial.printf("{\"all_relays\":\"%s\"}\n", on ? "ON" : "OFF");
}

void printRelayStatus() {
  Serial.print("{\"relay_status\":[");
  for (int i = 0; i < NUM_RELAYS; i++) {
    if (i > 0) Serial.print(",");
    Serial.printf("{\"relay\":%d,\"state\":\"%s\"}", i + 1, relay_states[i] ? "ON" : "OFF");
  }
  Serial.println("]}");
}





void processCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  if (cmd == "HELP") { Serial.println("Commands: R1 ON/OFF, ALL ON/OFF, STATUS"); return; }
  if (cmd == "STATUS") { printRelayStatus(); return; }
  if (cmd.startsWith("ALL")) {
    setAllRelays(cmd.indexOf("ON") >= 0);
    printRelayStatus();
    return;
  }
  if (cmd.startsWith("R") && cmd.length() >= 4) {
    int relayNum = cmd.substring(1).toInt(); // Support R1-R9
    if (relayNum >= 1 && relayNum <= 9) {
      setRelay(relayNum, cmd.indexOf("ON") >= 0);
      printRelayStatus();
    }
  }
}

void connectWiFi() {
  Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  wifi_connected = (WiFi.status() == WL_CONNECTED);
  Serial.println();
  if (wifi_connected) {
    Serial.print("WiFi connected! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi failed, will retry...");
  }
}



void uploadSensorData(float temp_c, float humidity, float tds_ppm, float ph_v, float do_v) {
  if (!wifi_connected) return;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/ingest";
  JsonDocument doc;
  doc["key"] = API_KEY;
  doc["device"] = DEVICE_ID;
  JsonObject readings = doc["readings"].to<JsonObject>();
  readings["temperature_c"] = temp_c;
  readings["humidity"] = humidity;
  readings["tds_ppm"] = tds_ppm;
  readings["ph_voltage_v"] = ph_v;
  readings["do_voltage_v"] = do_v;
  String payload;
  serializeJson(doc, payload);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  if (code == 200) Serial.println("Sensors uploaded");
  http.end();

}

// Poll Railway API for relay states (REST fallback when MQTT unavailable)
void pollRelayStates() {
  if (!wifi_connected) return;
  
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/relay/pending";
  
  http.begin(url);
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    String payload = http.getString();
    Serial.printf("Poll: %s\n", payload.c_str());
    JsonDocument doc;
    if (!deserializeJson(doc, payload)) {
      const char* states = doc["states"];
      if (states && strlen(states) == NUM_RELAYS) {  // Now expects 9 chars
        for (int i = 0; i < NUM_RELAYS; i++) {
          bool newState = (states[i] == '1');
          if (relay_states[i] != newState) {
            setRelay(i + 1, newState);
            Serial.printf("Cloud: Relay %d -> %s\n", i + 1, newState ? "ON" : "OFF");
          }
        }
      }
    }
  } else {
    Serial.printf("Poll failed: %d\n", httpCode);
  }
  http.end();
}

void setup() {
  Serial.begin(BAUD);
  delay(200);
  Serial.println("\n=== SIBOLTECH ESP32 MQTT Controller ===");

  for (int i = 0; i < NUM_RELAYS; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], HIGH);
  }
  Serial.println("Relays initialized (GPIO 12-19, 23)");

  analogReadResolution(12);
  analogSetPinAttenuation(TDS_PIN, ADC_0db);
  analogSetPinAttenuation(PH_PIN, ADC_11db);
  analogSetPinAttenuation(DO_PIN, ADC_11db);

  Wire.begin(I2C_SDA, I2C_SCL);
  bme_ok = init_bme();
  Serial.println(bme_ok ? "BME280: OK" : "BME280: NOT FOUND");

  connectWiFi();


}

void loop() {
  const uint32_t now = millis();

  // === PRIORITY 1: Serial commands (fastest response) ===
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serial_buffer.length() > 0) { processCommand(serial_buffer); serial_buffer = ""; }
    } else { serial_buffer += c; }
  }

  // === PRIORITY 2: Relay polling (100ms) ===
  if (now - last_relay_poll_ms >= RELAY_POLL_INTERVAL) {
    last_relay_poll_ms = now;
    pollRelayStates();
  }

  // === PRIORITY 3: WiFi reconnect ===
  if (WiFi.status() != WL_CONNECTED) {
    static uint32_t last_wifi = 0;
    if (now - last_wifi > 10000) { last_wifi = now; connectWiFi(); }
  }
  wifi_connected = (WiFi.status() == WL_CONNECTED);

  // === PRIORITY 4: Sensor reading (1s interval) ===
  if (now - last_print_ms < 1000) { return; }
  last_print_ms = now;

  // Read BME280 if available
  float temp_c = 25.0f;
  float humidity = 50.0f;
  
  if (bme_ok) {
    temp_c = bme.readTemperature();
    humidity = bme.readHumidity();
  }

  const int samples = 20;
  uint32_t acc = 0, acc_ph = 0, acc_do = 0;
  for (int i = 0; i < samples; i++) {
    acc += analogRead(TDS_PIN);
    acc_ph += analogRead(PH_PIN);
    acc_do += analogRead(DO_PIN);
    delay(2);
  }
  float voltage = ((float)acc / samples / ADC_MAX) * ADC_VREF;
  float ph_voltage = ((float)acc_ph / samples / ADC_MAX) * ADC_VREF;
  float do_voltage = ((float)acc_do / samples / ADC_MAX) * ADC_VREF;

  float comp = 1.0f + 0.02f * (temp_c - 25.0f);
  float comp_v = comp > 0 ? voltage / comp : voltage;
  float tds_ppm = (133.42f*comp_v*comp_v*comp_v - 255.86f*comp_v*comp_v + 857.39f*comp_v) * TDS_FACTOR;

  Serial.printf("{\"device\":\"%s\",\"readings\":{\"temp\":%.2f,\"humidity\":%.2f,\"tds\":%.2f}}\n",
                DEVICE_ID, temp_c, humidity, tds_ppm);

  if (now - last_sensor_upload_ms >= SENSOR_UPLOAD_INTERVAL) {
    last_sensor_upload_ms = now;
    uploadSensorData(temp_c, humidity, tds_ppm, ph_voltage, do_voltage);
  }
}
