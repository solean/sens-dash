import os
import time
import ssl

import board
import displayio
import socketpool
import terminalio
import wifi
from adafruit_display_text import label

import adafruit_requests
import adafruit_stcc4


# Display colors
COLOR_BG = 0x071018
COLOR_TITLE = 0x7DD3FC
COLOR_MUTED = 0x94A3B8
COLOR_GOOD = 0x22C55E
COLOR_WARN = 0xF59E0B
COLOR_BAD = 0xEF4444
COLOR_INFO = 0x38BDF8


# Configuration from CIRCUITPY/settings.toml
WIFI_SSID = os.getenv("CIRCUITPY_WIFI_SSID")
WIFI_PASSWORD = os.getenv("CIRCUITPY_WIFI_PASSWORD")
CONVEX_INGEST_URL = os.getenv("CONVEX_INGEST_URL")
DEVICE_ID = os.getenv("SENSOR_DEVICE_ID") or "office-feather-01"
DEVICE_SECRET = os.getenv("SENSOR_DEVICE_SECRET")
READ_INTERVAL_SECONDS = int(os.getenv("SENSOR_READ_INTERVAL_SECONDS") or 5)
POST_INTERVAL_SECONDS = int(os.getenv("SENSOR_POST_INTERVAL_SECONDS") or 60)


# Sensor setup
i2c = board.I2C()
sensor = adafruit_stcc4.STCC4(i2c)


# Display setup
display = board.DISPLAY
group = displayio.Group()
display.root_group = group

background = displayio.Bitmap(display.width, display.height, 1)
background_palette = displayio.Palette(1)
background_palette[0] = COLOR_BG
group.append(displayio.TileGrid(background, pixel_shader=background_palette))

title = label.Label(
    terminalio.FONT,
    text="Air Monitor",
    x=10,
    y=18,
    scale=2,
    color=COLOR_TITLE,
)

co2_label = label.Label(
    terminalio.FONT,
    text="CO2: -- ppm",
    x=10,
    y=50,
    scale=2,
    color=COLOR_MUTED,
)

temp_label = label.Label(
    terminalio.FONT,
    text="Temp: -- F",
    x=10,
    y=78,
    scale=2,
    color=COLOR_MUTED,
)

humidity_label = label.Label(
    terminalio.FONT,
    text="RH: -- %",
    x=10,
    y=106,
    scale=2,
    color=COLOR_MUTED,
)

status_label = label.Label(
    terminalio.FONT,
    text="Starting...",
    x=10,
    y=128,
    scale=1,
    color=COLOR_INFO,
)

group.append(title)
group.append(co2_label)
group.append(temp_label)
group.append(humidity_label)
group.append(status_label)


requests = None
last_post_monotonic = -POST_INTERVAL_SECONDS


def co2_color(co2):
    if co2 < 800:
        return COLOR_GOOD
    if co2 < 1200:
        return COLOR_WARN
    return COLOR_BAD


def temp_color(temp_f):
    if 68 <= temp_f <= 76:
        return COLOR_GOOD
    if 62 <= temp_f <= 82:
        return COLOR_WARN
    return COLOR_BAD


def humidity_color(humidity):
    if 30 <= humidity <= 60:
        return COLOR_GOOD
    if 20 <= humidity <= 70:
        return COLOR_WARN
    return COLOR_BAD


def set_status(text, color=COLOR_MUTED):
    status_label.text = text[:36]
    status_label.color = color
    print(text)


def connect_wifi():
    if wifi.radio.connected:
        return True

    if not WIFI_SSID or not WIFI_PASSWORD:
        set_status("WiFi settings missing", COLOR_BAD)
        return False

    try:
        set_status("Connecting WiFi...", COLOR_INFO)
        wifi.radio.connect(WIFI_SSID, WIFI_PASSWORD)
        set_status("WiFi: {}".format(wifi.radio.ipv4_address), COLOR_GOOD)
        return True
    except Exception as error:
        set_status("WiFi failed", COLOR_BAD)
        print("WiFi error:", repr(error))
        return False


def get_requests_session():
    global requests

    if requests is not None:
        return requests

    pool = socketpool.SocketPool(wifi.radio)
    requests = adafruit_requests.Session(pool, ssl.create_default_context())
    return requests


def post_reading(co2, temp_c, humidity):
    if not CONVEX_INGEST_URL or not DEVICE_SECRET:
        set_status("Cloud config missing", COLOR_BAD)
        return False

    if not connect_wifi():
        return False

    payload = {
        "deviceId": DEVICE_ID,
        "tempC": temp_c,
        "humidityPct": humidity,
        "co2Ppm": co2,
    }

    headers = {
        "Authorization": "Bearer {}".format(DEVICE_SECRET),
        "Content-Type": "application/json",
    }

    response = None
    try:
        session = get_requests_session()
        response = session.post(
            CONVEX_INGEST_URL,
            json=payload,
            headers=headers,
            timeout=10,
        )

        if 200 <= response.status_code < 300:
            set_status("Uploaded reading", COLOR_GOOD)
            return True

        set_status("Upload HTTP {}".format(response.status_code), COLOR_WARN)
        print("Upload response:", response.text)
        return False
    except Exception as error:
        set_status("Upload failed", COLOR_BAD)
        print("Upload error:", repr(error))
        return False
    finally:
        if response is not None:
            response.close()


connect_wifi()

while True:
    co2 = sensor.CO2
    temp_c = sensor.temperature
    humidity = sensor.relative_humidity
    temp_f = temp_c * 9 / 5 + 32

    co2_label.text = "CO2: {:.0f} ppm".format(co2)
    temp_label.text = "Temp: {:.1f} F".format(temp_f)
    humidity_label.text = "RH: {:.1f}%".format(humidity)
    co2_label.color = co2_color(co2)
    temp_label.color = temp_color(temp_f)
    humidity_label.color = humidity_color(humidity)

    print(
        "CO2: {:.0f} ppm | Temp: {:.1f} F | RH: {:.1f}%".format(
            co2,
            temp_f,
            humidity,
        )
    )

    now = time.monotonic()
    if now - last_post_monotonic >= POST_INTERVAL_SECONDS:
        if post_reading(co2, temp_c, humidity):
            last_post_monotonic = now
        else:
            # Try again on the next read instead of waiting a full post interval.
            last_post_monotonic = now - POST_INTERVAL_SECONDS + READ_INTERVAL_SECONDS

    time.sleep(READ_INTERVAL_SECONDS)
