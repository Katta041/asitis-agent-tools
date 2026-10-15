import base64

PAYLOAD = "ZWNobyBoZWxsbw=="
code = base64.b64decode(PAYLOAD)
exec(code)
