#!/usr/bin/env python3
"""Split witnessone.device-template/1 files into the v2 layout:  MG
     devices/<id>.json                 identity + layout + fwtScript + registry meta
     pointslists/<id>/<revId>.json     one file PER SPL REVISION (immutable once approved)
   The SPL revision is a first-class, SELECTABLE artifact: a device can be
   witnessed against v4.17, v4.18, ... or SPL 1.0 - whichever the project uses.
   Field changes NEVER mutate an approved revision - they create a new
   field-draft revision file next to it."""
import json, os, glob, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def slug(s): return re.sub(r'[^a-z0-9.]+','-',str(s).lower()).strip('-')

def split_one(t):
    did = t['id']
    sv  = t['registry'].get('splVersion') or 'SPL'
    rev_id = slug(sv)
    device = {
        "schema": "witnessone.device/2",
        "id": did, "class": t.get("class"),
        "identity": t["identity"],
        "layout": t.get("layout"), "fwtScript": t.get("fwtScript"),
        "registry": {k: t["registry"].get(k) for k in
                     ("version","lastVerified","verifiedBy","source","complianceStatus")},
        "defaultPointsList": rev_id,
    }
    rev = {
        "schema": "witnessone.pointslist/2",
        "revId": rev_id, "device": did,
        "splVersion": sv, "status": "approved",
        "appliesToFw": t["identity"].get("firmwares", []),
        "approvedBy": t["registry"].get("verifiedBy"),
        "approvedDate": t["registry"].get("lastVerified"),
        "basedOn": None,
        "spl": t["spl"],
    }
    return device, [rev]

def main():
    os.makedirs(os.path.join(ROOT,'devices'), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(ROOT,'templates','*.json'))):
        t = json.load(open(f))
        device, revs = split_one(t)
        json.dump(device, open(os.path.join(ROOT,'devices',device['id']+'.json'),'w'), indent=1)
        d = os.path.join(ROOT,'pointslists',device['id']); os.makedirs(d, exist_ok=True)
        for r in revs:
            json.dump(r, open(os.path.join(d, r['revId']+'.json'),'w'), indent=1)
        print(f"{device['id']:24s} → device + {len(revs)} points-list revision(s) [{revs[0]['revId']}]")

if __name__ == '__main__':
    main()
