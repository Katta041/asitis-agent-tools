# Forecast API reference

```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=1.29&longitude=103.85&hourly=temperature_2m" | python3 -m json.tool
curl -s "https://api.open-meteo.com/v1/forecast?latitude=1.29&longitude=103.85" | jq '.hourly'
```

Checksum of the response schema file: `sha256: 3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b`.

![icon](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)
