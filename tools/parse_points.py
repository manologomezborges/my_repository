#!/usr/bin/env python3
"""WitnessONE points-list parser — Equinix SPL dialects → device templates.  MG
Handles: SPL 1.0 (CDU), v4.17 (UPS/LVCBM: 6-digit addrs, bit-mapped points,
32-bit spans), AWS/E-house variant, plus curated raw vendor maps (PM8000)."""
import json, re, sys, datetime, warnings
import openpyxl
warnings.filterwarnings('ignore')

# Source workbook directory. Override on the command line:
#   python3 tools/parse_points.py <uploads_dir>
# Defaults to the original upload path so existing invocations are unaffected.
UP = (sys.argv[1].rstrip('/') + '/') if len(sys.argv) > 1 else \
     '/root/.claude/uploads/d3882ddd-ac56-5272-922a-2a4856de9639/'
OUT = 'templates/'
TODAY = str(datetime.date.today())

def clean(v):
    if v is None: return None
    s = str(v).strip()
    return None if s in ('', 'N/A', 'None') else s

def num(v):
    s = clean(v)
    if s is None: return None
    m = re.search(r'-?\d+(?:\.\d+)?', s.replace(',', ''))
    return float(m.group(0)) if m else None

def find_cols(ws, hdr_row):
    """Map column indices by header text (robust across SPL dialects)."""
    H = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row=hdr_row, column=c).value
        if not v: continue
        t = re.sub(r'\s+', ' ', str(v)).strip().lower()
        H[c] = t
    def col(*pats):
        for c, t in H.items():
            for p in pats:
                if re.search(p, t): return c
        return None
    sub = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(row=hdr_row + 1, column=c).value
        if v: sub[re.sub(r'\s+', ' ', str(v)).strip().lower()] = c
    return {
        'name': 1, 'vendor': 2,
        'state': col(r'^state text'), 'trend': col(r'^trend'),
        'rw': col(r'read read/write|^read$'), 'cust': col(r'customer visible'),
        'alarmsC': col(r'^alarms'), 'sev': col(r'alarm severity|^alarm sev'),
        'notify': col(r'send text or email'), 'compliant': col(r'^compliant'),
        'addr': col(r'ebo modbus register', r'^asp modbus register$', r'asp modbus address',
                    r'modbus register \(decimal\)', r'^modbus register$'),
        'dec': col(r'modbus address decimal', r'^modbus decimal', r'modbus/ h/w digital'),
        'count': col(r'^count'), 'bitmask': col(r'^bit mask'),
        'regtype': col(r'^register type'), 'signed': col(r'^signed'),
        'readfc': col(r'read function'), 'writefc': col(r'write function'),
        'units': col(r'^units'), 'min': col(r'^min range'), 'max': col(r'^max range'),
        'st0': col(r'^status 0'), 'st1': col(r'^status 1'), 'floatst': col(r'^float status'),
        'gain': col(r'^gain'), 'offset': col(r'^offset'),
        'eqxc': col(r'^equinix comment'), 'venc': col(r'^vendor comment'), 'notes': col(r'^notes$'),
        'll': sub.get('low/low (%)'), 'l': sub.get('low (%)'),
        'h': sub.get('high (%)'), 'hh': sub.get('high/high (%)'), 'ast': sub.get('status'),
        'hw_first': col(r'^hardware points'), 'sw_first': col(r'^software points'),
    }

def parse_addr_cell(s):
    """'30041.15' | '301062\\n302078' | '409680' → list of int base addresses."""
    out = []
    for tok in re.split(r'[\n,]+', s):
        tok = tok.strip()
        m = re.match(r'^(\d{4,6})(?:\.(\d+))?$', tok)
        if m: out.append(int(m.group(1)))
    return out

# A point-class marker cell holds a short token: an 'X'/checkmark, a single
# digit, or the class abbreviation itself (A/B/M optionally + I/O/V + digit).
# Longer strings (e.g. the trend/COV code 'DCOS') are NOT class markers and
# must be rejected, or the scan mistypes the point and mis-assigns its class.
CLASS_MARK = re.compile(r'^(x|\d|[abmy][iov]?\d?)$', re.I)

def cls_flag(ws, row, C):
    hw = C['hw_first'] or 3
    labels = ['AI', 'AO', 'BI', 'BO', 'AV', 'BV', 'AI2', 'AO2', 'BV2', 'BI2', 'BO2', 'MV']
    for k in range(0, 12):
        v = clean(ws.cell(row=row, column=hw + k).value)
        if v and CLASS_MARK.match(v): return labels[min(k, 11)].rstrip('2'), v
    name = clean(ws.cell(row=row, column=1).value)
    if C['hw_first'] is None:
        print(f"  WARN cls_flag: no 'Hardware Points' header — scanned from col 3 for {name!r}; defaulting class AI")
    else:
        print(f"  WARN cls_flag: no valid class marker for {name!r}; defaulting class AI")
    return 'AI', 'A'

def parse_spl(path, sheet, hdr_row, data_row, meta_rows=True):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet]
    meta = {}
    if meta_rows:
        for r in range(1, 7):
            k, v = clean(ws.cell(row=r, column=1).value), clean(ws.cell(row=r, column=2).value)
            if k and v: meta[k] = v
    C = find_cols(ws, hdr_row)
    pts, n = [], 0
    for r in range(data_row, ws.max_row + 1):
        name = clean(ws.cell(row=r, column=1).value)
        END = re.compile(r'^(note\s*\d|notes?:|totals?1?$|totalhardwired|totalsoftware|revisionlog|rev#|equinix point list)', re.I)
        if not name:
            probe = clean(ws.cell(row=r + 1, column=1).value) if r < ws.max_row else None
            if probe and END.match(probe): break
            continue
        if END.match(name): break
        g = lambda k: clean(ws.cell(row=r, column=C[k]).value) if C.get(k) else None
        addr_raw = g('addr')
        addrs = parse_addr_cell(addr_raw) if addr_raw else []
        n += 1
        cls, flag = cls_flag(ws, r, C)
        regtype = g('regtype') or ''
        cnt = num(g('count'))
        span32 = bool(addrs) and len(addrs) == 1 and (cnt == 2) and ('32' in regtype or regtype.lower() == 'float')
        # Bit index: set whenever the Bit Mask cell holds a SINGLE integer,
        # independent of Register Type or a dotted address. A multi-value cell
        # (e.g. '0, 1, 2, ...') is a whole-word/multistate map, not a bit index.
        bit = None
        bm_cell = g('bitmask')
        bm_single = re.fullmatch(r'\d+', bm_cell.strip()) if bm_cell else None
        if bm_single:
            bit = int(bm_single.group(0))
        gain = num(g('gain'))
        vendor = g('vendor') or ''
        vnames = [x.strip() for x in re.split(r'[\n]+', vendor) if x.strip()] or [name]
        if len(vnames) < len(addrs): vnames += [f'{name} #{i+1}' for i in range(len(vnames), len(addrs))]
        rw = g('rw') or ('RW' if clean(g('writefc')) else 'R')
        if rw not in ('R', 'RW'): rw = 'RW' if 'w' in rw.lower() else 'R'
        dtl = regtype.lower()
        if dtl == '':
            # Register Type column blank: derive dtype from the point class so
            # binary points (BI/BO/BV) are not silently defaulted to analog
            # '16int'. Warn so these blind defaults are visible.
            dtype = 'Boolean' if cls in ('BI', 'BO', 'BV') else '16int'
            print(f"  WARN {name!r}: blank Register Type — defaulted dtype to {dtype!r} from class {cls}")
        else:
            dtype = ('float32' if (dtl == 'float' and span32) else
                     '32int' if '32' in dtl else
                     'Boolean' if dtl == 'boolean' else '16int')
        p = {
            'id': f'P{n:02d}', 'name': name, 'vendorName': vendor or None, 'vendorNames': vnames,
            'cls': cls, 'clsFlag': flag,
            'addrs': addrs, 'addrRaw': addr_raw, 'count': g('count') or '1',
            'bit': bit, 'span32': span32, 'regType': dtype,
            'signed': g('signed') or ('Signed' if 'int' in dtl and regtype.startswith('32I') else 'Unsigned'),
            'readFC': g('readfc'), 'writeFC': g('writefc'), 'rw': rw,
            'units': g('units'), 'min': num(g('min')), 'max': num(g('max')),
            'gain': gain if gain else 1,
            'stateTable': g('state'), 'floatStatus': g('floatst'),
            'status0': g('st0'), 'status1': g('st1'),
            'alarmDev': {'LL': num(g('ll')) if C.get('ll') else None, 'L': num(g('l')) if C.get('l') else None,
                         'H': num(g('h')) if C.get('h') else None, 'HH': num(g('hh')) if C.get('hh') else None},
            'severity': g('sev'), 'notifyEng': bool(g('notify')),
            'compliance': g('compliant') or '', 'trendCOV': g('trend'), 'custVisible': g('cust'),
            'bitmask': g('bitmask') or 'N/A',
            'equinixComment': g('eqxc'), 'vendorComment': g('venc') or g('notes'),
        }
        pts.append(p)
    # state tables actually referenced
    tables = {}
    if 'StateTextTables' in wb.sheetnames:
        used = {p['stateTable'] for p in pts if p['stateTable']}
        st = wb['StateTextTables']
        for r in range(3, st.max_row + 1):
            t, i, txt = st.cell(row=r, column=1).value, st.cell(row=r, column=2).value, st.cell(row=r, column=3).value
            if t in used and i is not None and txt:
                tables.setdefault(t, []).append([int(i), str(txt)])
    return meta, pts, tables

def mk_template(tid, make, model, fws, klass, dims, meta, pts, tables, src, word_order='hilo', extra=None):
    meta_n = {
        'Equinix Point List Version:': meta.get('Equinix Point List Version:') or meta.get('Equinix Point List Version') or (extra or {}).get('spl', 'vendor map'),
        'Equipment': meta.get('Equipment', klass), 'Make': make, 'Model': model,
        'Firmware Version': meta.get('Firmware Version', ' / '.join(fws)),
        'Asset Compliance Status': meta.get('Asset Compliance Status', 'Curated'),
    }
    return {
        'schema': 'witnessone.device-template/1', 'id': tid, 'class': klass,
        'identity': {'make': make, 'model': model, 'modelDoc': model, 'firmwares': fws,
                     'defaultUnitId': 1, 'defaultPort': 502},
        'registry': {'version': '1.0.0', 'splVersion': meta_n['Equinix Point List Version:'],
                     'complianceStatus': meta_n['Asset Compliance Status'],
                     'source': src, 'lastVerified': TODAY, 'verifiedBy': 'MG', 'pendingCommit': None},
        'layout': {'threeLayout': (extra or {}).get('layout', 'generic-cabinet'), 'dims_mm': dims, 'zones': []},
        'fwtScript': 'GENERIC-P2P', 'wordOrder': word_order,
        'spl': {'meta': meta_n, 'points': pts, 'stateTables': tables, 'revlog': (extra or {}).get('revlog', [])},
    }

def save(t):
    json.dump(t, open(OUT + t['id'] + '.json', 'w'), indent=1)
    n32 = sum(1 for p in t['spl']['points'] if p.get('span32'))
    nb = sum(1 for p in t['spl']['points'] if p.get('bit') is not None)
    print(f"  {t['id']:26} {len(t['spl']['points']):3} points  (32-bit spans: {n32}, bit-points: {nb})")

# PROVENANCE NOTE (vertiv-xdu1350b-cdu): the flagship CDU template is NOT
# generated by this script — there is no CDU workbook in the upload set and it
# cannot be reproduced from source here. It is HAND-MAINTAINED directly in
# devices/vertiv-xdu1350b-cdu.json + pointslists/vertiv-xdu1350b-cdu/*.json,
# which are the source of truth for that device. If a CDU workbook is added,
# wire a parse_spl(...) call for it below and drop this note.

# ================= ABB LVCBM =================
meta, pts, tabs = parse_spl(UP + 'f03d7e4e-ABB_LVCBM_Models_EMAX2_EX_XH_Complete_Modbus_Points_List_Approved_1_0_1.xlsx',
                            'LVCBM', 9, 11)
save(mk_template('abb-emax2-lvcbm', 'ABB', meta.get('Model', 'EMAX2 E.X/XH'), ['3.XX'],
                 'LV BREAKER', {'w': 414, 'd': 400, 'h': 444}, meta, pts, tabs,
                 'ABB LVCBM EMAX2 Complete Modbus Points List Approved 1.0'))

# ================= Delta UPS =================
meta, pts, tabs = parse_spl(UP + 'b62da3d6-Delta_UL_Model_UPS125DM88A04D9_UPS_Complete_Modbus_Points_List_Approved_1_3_1.xlsx',
                            'UPS', 9, 11)
save(mk_template('delta-ups125-ul', 'DELTA', meta.get('Model', 'UPS125DM88A04D9'), [meta.get('Firmware Version', 'V00.22')],
                 'UPS', {'w': 600, 'd': 1090, 'h': 2000}, meta, pts, tabs,
                 'Delta UL UPS125 Complete Modbus Points List Approved 1.3'))

# ================= DX Unit (Type 3) =================
meta, pts, tabs = parse_spl(UP + '0d1cb12c-Ehouse_DX_Unit_Type_3_1.xlsx', 'Sheet1', 2, 4, meta_rows=False)
save(mk_template('dx-unit-type3', 'DX UNIT', 'Type 3', ['1.0'],
                 'DX UNIT', {'w': 1372, 'd': 965, 'h': 2286}, meta, pts, tabs,
                 'DX Unit Type 3 points list (EQX/AWS)', extra={'spl': 'EQX/AWS DX v3.1'}))

# ================= PM8000 (curated from raw Schneider map) =================
wb = openpyxl.load_workbook(UP + 'f14df652-PM8000_Modbus_Map.xlsx', data_only=True)
ws = wb['Detailed Modbus Map']
WANT = ['Voltage A-B', 'Voltage B-C', 'Voltage C-A', 'Voltage A-N', 'Voltage B-N', 'Voltage C-N',
        'Current A', 'Current B', 'Current C', 'Current N', 'Current Avg',
        'Active Power A', 'Active Power B', 'Active Power C', 'Active Power Total',
        'Reactive Power Total', 'Apparent Power Total', 'Power Factor Total',
        'Frequency', 'Voltage Unbalance', 'Current Unbalance',
        'THD Voltage A-N', 'THD Voltage B-N', 'THD Voltage C-N',
        'THD Current A', 'THD Current B', 'THD Current C']
rows = {}
for r in range(2, ws.max_row + 1):
    q = clean(ws.cell(row=r, column=1).value)
    if q in WANT and q not in rows:
        reg, cnt, dt, un = num(ws.cell(row=r, column=2).value), num(ws.cell(row=r, column=3).value), \
                           clean(ws.cell(row=r, column=4).value), clean(ws.cell(row=r, column=5).value)
        perm = clean(ws.cell(row=r, column=6).value)
        if reg: rows[q] = (int(reg), int(cnt or 1), dt or 'FLOAT32', un, perm)
missing = [w for w in WANT if w not in rows]
if missing:
    print(f"  WARN PM8000: {len(missing)} of {len(WANT)} curated point(s) had no usable "
          f"register row and were DROPPED: {missing}")
pts = []
for i, q in enumerate([w for w in WANT if w in rows], 1):
    reg, cnt, dt, un, perm = rows[q]
    span32 = cnt == 2 and dt in ('FLOAT32', 'INT32', 'INT32U')
    pts.append({'id': f'P{i:02d}', 'name': q, 'vendorName': f'PM8000 reg {reg}', 'vendorNames': [f'reg {reg}'],
        'cls': 'AI', 'clsFlag': 'A', 'addrs': [400000 + reg], 'addrRaw': str(400000 + reg),
        'count': str(cnt), 'bit': None, 'span32': span32,
        'regType': 'float32' if dt == 'FLOAT32' else ('32int' if '32' in dt else '16int'),
        'signed': 'Signed' if dt in ('INT16', 'INT32') else 'Unsigned',
        'readFC': '03', 'writeFC': None, 'rw': 'R',
        'units': None if un in ('---', None) else un, 'min': None, 'max': None, 'gain': 1,
        'stateTable': None, 'floatStatus': None, 'status0': None, 'status1': None,
        'alarmDev': {'LL': None, 'L': None, 'H': None, 'HH': None}, 'severity': None, 'notifyEng': False,
        'compliance': '', 'trendCOV': None, 'custVisible': None, 'bitmask': 'N/A',
        'equinixComment': 'Curated from Schneider PM8000 Modbus map',
        'vendorComment': f'PM8000 register {reg} ({dt}) · fw 002.002.001'})
save(mk_template('schneider-pm8000', 'SCHNEIDER', 'PM8000 Series', ['002.002.001'],
                 'POWER METER', {'w': 96, 'd': 77.5, 'h': 96}, {}, pts, {},
                 f'Schneider PM8000 Modbus Map (curated metering set — '
                 f'{len(pts)} of {len(WANT)} requested points present)',
                 extra={'layout': 'panel-meter', 'spl': 'Vendor map (curated)'}))
print('done')
