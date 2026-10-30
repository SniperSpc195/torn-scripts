import json
import re
from pathlib import Path


SCRIPT_FILES = [
    "API_Test.js",
    "Crime_Value.js",
    "Fight_History.js",
    "Item_RRP_for_City_Store.js",
    "City_Resale_Filter.js",
    "Travel_Profit_Optimizer.js",
]
BASE_URL = "https://raw.githubusercontent.com/SniperSpc195/torn-scripts/main/TornPDA"
HEADER_VALUE = re.compile(r"^\s*//\s*@([\w-]+)\s+(.+?)\s*$", re.MULTILINE)


def parse_header(source):
    return {key.lower(): value for key, value in HEADER_VALUE.findall(source)}


def build_script(path):
    source = path.read_text(encoding="utf-8")
    header = parse_header(source)
    download_url = header.get("downloadurl", f"{BASE_URL}/{path.name}")
    grants = re.findall(r"^\s*//\s*@grant\s+(.+?)\s*$", source, re.MULTILINE)
    requires = re.findall(r"^\s*//\s*@require\s+(.+?)\s*$", source, re.MULTILINE)
    matches = re.findall(r"^\s*//\s*@match\s+(.+?)\s*$", source, re.MULTILINE)

    return {
        "enabled": False,
        "matches": matches or ["*"],
        "name": header.get("name", path.stem),
        "version": header.get("version", "0.0.0"),
        "edited": False,
        "source": source,
        "url": download_url,
        "updateUrl": header.get("updateurl"),
        "updateStatus": "upToDate" if download_url else "noRemote",
        "isExample": False,
        "time": "start" if header.get("run-at") == "document-start" else "end",
        "customApiKey": "",
        "customApiKeyCandidate": "###PDA-APIKEY###" in source,
        "grants": grants,
        "requires": requires,
        "installedAt": 0,
        "warEnabled": False,
    }


def main():
    folder = Path(__file__).resolve().parent
    scripts = [build_script(folder / filename) for filename in SCRIPT_FILES]
    output = folder / "userscripts_import.json"
    output.write_text(json.dumps(scripts, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Created {output} with {len(scripts)} scripts.")


if __name__ == "__main__":
    main()
