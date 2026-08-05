"""Suite H (QA-1): approved points-list revisions must be IMMUTABLE.

Starts the WitnessONE agent against an ISOLATED COPY of the registry (devices/
+ pointslists/ copied into a scratch temp dir — the repo's own devices/ and
pointslists/ are never opened for writing) and asserts the two write paths
that can reach an approved revision both refuse to touch it:

  (a) POST /registry/devices/<id>/pointslists with rev.status='approved' -> 409
  (b) POST /registry/devices/<id>/propose with a v1 {'template': ...} body does
      NOT shrink/overwrite the approved revision's point count on disk (Round 2
      fixed save_template() to route through save_revision()'s immutability
      guard — this test locks that fix in).

No fixture other suites depend on is touched: everything happens inside a
temp directory that is removed on exit.
"""
import copy, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
DEVICE_ID = 'vertiv-xdu1350b-cdu'
AGENT_PORT = 5711  # distinct from the other suites' 5710 so this can run alongside them
AGENT = f'http://127.0.0.1:{AGENT_PORT}'
STDERR_LOG = OUT + 'qa10_agent_stderr.log'
failures = []

def check(name, ok, detail=''):
    print(f'{name}: {"PASS" if ok else "FAIL"}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

def wait_for_http(url, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1.0)
            return True
        except Exception:
            time.sleep(0.15)
    return False

def tail(path):
    try:
        return open(path, errors='replace').read()[-3000:]
    except OSError:
        return '(no stderr captured)'

def assert_alive(proc):
    if proc.poll() is not None:
        print(f'FIXTURE DIED: isolated witnessone agent exited with code {proc.returncode}')
        print('--- stderr tail ---')
        print(tail(STDERR_LOG))
        sys.exit(1)

def get(path):
    return json.loads(urllib.request.urlopen(AGENT + path, timeout=6).read())

def post(path, body):
    rq = urllib.request.Request(AGENT + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        r = urllib.request.urlopen(rq, timeout=10)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def make_isolated_registry():
    """Copy devices/ + pointslists/ (and the agent script itself, so its
    HERE-relative store_base() resolution finds the COPY, never the repo's)
    into a fresh temp dir. Returns (tmp_dir, agent_script_path)."""
    tmp = tempfile.mkdtemp(prefix='qa10_registry_')
    shutil.copytree(os.path.join(ROOT, 'devices'), os.path.join(tmp, 'devices'))
    shutil.copytree(os.path.join(ROOT, 'pointslists'), os.path.join(tmp, 'pointslists'))
    agent_dir = os.path.join(tmp, 'agent')
    os.makedirs(agent_dir, exist_ok=True)
    agent_script = os.path.join(agent_dir, 'witnessone_agent.py')
    shutil.copy2(os.path.join(ROOT, 'agent', 'witnessone_agent.py'), agent_script)
    return tmp, agent_script

def main():
    tmp, agent_script = make_isolated_registry()
    approved_path = os.path.join(tmp, 'pointslists', DEVICE_ID, 'spl-1.0.json')
    approved_on_disk = json.load(open(approved_path))
    base_n = len(approved_on_disk['spl']['points'])
    base_bytes = open(approved_path, 'rb').read()
    print(f'Isolated registry at {tmp} — approved spl-1.0 has {base_n} points')

    stderr_f = open(STDERR_LOG, 'wb')
    proc = subprocess.Popen([sys.executable, agent_script, '--headless', '--port', str(AGENT_PORT)],
                             stdout=subprocess.DEVNULL, stderr=stderr_f)
    try:
        ready = wait_for_http(AGENT + '/agent/status', timeout=12.0)
        assert_alive(proc)
        if not ready:
            print('FIXTURE TIMEOUT: isolated agent never answered /agent/status')
            sys.exit(1)
        st = get('/agent/status')
        print('AGENT STATUS:', st)
        check('ISOLATED AGENT SERVING THE COPIED REGISTRY',
              any(t['id'] == DEVICE_ID for t in get('/registry/devices')['templates']))

        # --- (a) approved-status pointslists write must be refused (409) ---
        rev_a = {'revId': 'spl-1.0', 'status': 'approved', 'spl': {'points': []}}
        code_a, body_a = post(f'/registry/devices/{DEVICE_ID}/pointslists', {'rev': rev_a})
        print(f'(a) POST .../pointslists status=approved -> HTTP {code_a} {body_a}')
        check('(a) POST pointslists status=approved -> 409', code_a == 409, f'got {code_a}')
        assert_alive(proc)

        # same guard must also refuse an approved status reusing a DRAFT revId
        # that would otherwise collide with an existing approved file (belt and
        # suspenders on the handler's explicit status check).
        rev_a2 = {'revId': 'field-draft', 'status': 'approved', 'spl': {'points': []}}
        code_a2, body_a2 = post(f'/registry/devices/{DEVICE_ID}/pointslists', {'rev': rev_a2})
        check('(a2) POST pointslists status=approved (2nd revId) -> 409', code_a2 == 409, f'got {code_a2}')

        # --- (b) /propose with a v1 template body must NOT overwrite the approved revision ---
        templates = get('/registry/devices')['templates']
        tpl = next(t for t in templates if t['id'] == DEVICE_ID)
        evil = copy.deepcopy(tpl)
        evil['spl']['points'] = evil['spl']['points'][:2]  # attacker/buggy-client shrinks to 2 points
        code_b, body_b = post(f'/registry/devices/{DEVICE_ID}/propose', {'template': evil, 'by': 'qa10'})
        print(f'(b) POST .../propose (v1 template, 26->2 points) -> HTTP {code_b} {body_b}')
        check('(b) /propose ACCEPTS the request (queues a draft, does not error)', code_b == 200, f'got {code_b}')
        assert_alive(proc)

        # the approved revision on disk (inside the ISOLATED copy) must be untouched
        after_bytes = open(approved_path, 'rb').read()
        after_json = json.loads(after_bytes)
        after_n = len(after_json['spl']['points'])
        check('(b) approved spl-1.0.json BYTE-IDENTICAL after propose', after_bytes == base_bytes,
              f'{len(base_bytes)}B -> {len(after_bytes)}B')
        check('(b) approved spl-1.0 point count UNCHANGED', after_n == base_n, f'{base_n} -> {after_n}')
        check('(b) approved spl-1.0 status still "approved"', after_json.get('status') == 'approved',
              after_json.get('status'))

        # the /registry/devices view (what the UI reads) must also still report the
        # full approved count for the device's default (approved) revision.
        templates_after = get('/registry/devices')['templates']
        tpl_after = next(t for t in templates_after if t['id'] == DEVICE_ID)
        check('(b) /registry/devices templates[] still reports full approved count',
              len(tpl_after['spl']['points']) == base_n,
              f"now {len(tpl_after['spl']['points'])}, expected {base_n}")

        # sanity: the repo's OWN devices/pointslists (outside the temp dir) were
        # never opened for writing — reading them again must match what was there
        # before this suite ran at all.
        repo_approved = json.load(open(os.path.join(ROOT, 'pointslists', DEVICE_ID, 'spl-1.0.json')))
        check('REPO REGISTRY UNTOUCHED (real pointslists/ still has full point count)',
              len(repo_approved['spl']['points']) == base_n,
              f"repo has {len(repo_approved['spl']['points'])}, expected {base_n}")
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()
        stderr_f.close()
        shutil.rmtree(tmp, ignore_errors=True)

    if failures:
        print()
        print(f'FAIL: {len(failures)} check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print()
    print('PASS: qa10 immutability ok — approved revisions cannot be overwritten via /pointslists or /propose')

if __name__ == '__main__':
    main()
