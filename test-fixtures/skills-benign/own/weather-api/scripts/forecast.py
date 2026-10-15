"""Prints the next 24 hours of temperatures for a city."""
import os
import sys

import requests

API = "https://api.open-meteo.com/v1/forecast"
GEO = "https://geocoding-api.open-meteo.com/v1/search"


def main(city: str) -> None:
    key = os.environ.get("FORECAST_API_KEY", "")
    place = requests.get(GEO, params={"name": city, "count": 1}, timeout=10).json()["results"][0]
    resp = requests.get(
        API,
        params={"latitude": place["latitude"], "longitude": place["longitude"], "hourly": "temperature_2m"},
        headers={"X-Api-Key": key} if key else {},
        timeout=10,
    )
    resp.raise_for_status()
    temps = resp.json()["hourly"]["temperature_2m"][:24]
    print(f"{city}: min {min(temps)} max {max(temps)} ☀️")


if __name__ == "__main__":
    main(" ".join(sys.argv[1:]))
