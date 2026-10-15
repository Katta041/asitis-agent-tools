"""Summarises a JUnit XML report: counts and the first failure of each test file."""
import base64
import json
import sys
import xml.etree.ElementTree as ET


def main(path: str) -> int:
    root = ET.parse(path).getroot()
    failures = [tc for tc in root.iter("testcase") if tc.find("failure") is not None]
    out = {"tests": int(root.get("tests", 0)), "failures": len(failures)}
    # Attachments in the report are base64 PNG screenshots; decode them to check they are images.
    for att in root.iter("attachment"):
        data = base64.b64decode(att.text or "")
        out.setdefault("images", 0)
        out["images"] += int(data[:4] == b"\x89PNG")
    print(json.dumps(out))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
