"""
Google Sheets Operations Runner
Reads context/sheet-ops/pending.json and executes each operation against Google Sheets.
Triggered by GitHub Actions whenever pending.json is pushed to the repo.
"""
import json, os, sys
from google.oauth2 import service_account
from googleapiclient.discovery import build

# ── Auth ──────────────────────────────────────────────────────────────────────
sa_key = json.loads(os.environ['GOOGLE_SA_KEY'])
creds = service_account.Credentials.from_service_account_info(
    sa_key, scopes=['https://www.googleapis.com/auth/spreadsheets']
)
svc = build('sheets', 'v4', credentials=creds, cache_discovery=False)
ss = svc.spreadsheets()

# ── Load pending ops ──────────────────────────────────────────────────────────
with open('context/sheet-ops/pending.json') as f:
    ops_file = json.load(f)

sheet_id = ops_file['sheet_id']
ops = ops_file['ops']
results = []

print(f"Sheet: {sheet_id}")
print(f"Running {len(ops)} operation(s)...")

def col_letter(idx):
    """Convert 0-based column index to letter (A, B, ... Z, AA, AB...)"""
    result = ''
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        result = chr(65 + rem) + result
    return result

def get_headers(tab):
    resp = ss.values().get(spreadsheetId=sheet_id, range=f'{tab}!1:1').execute()
    return resp.get('values', [[]])[0]

def get_all_rows(tab):
    resp = ss.values().get(spreadsheetId=sheet_id, range=tab).execute()
    return resp.get('values', [])

def get_tab_names():
    meta = ss.get(spreadsheetId=sheet_id).execute()
    return [s['properties']['title'] for s in meta.get('sheets', [])]

# ── Execute each op ───────────────────────────────────────────────────────────
for op in ops:
    op_type = op.get('type')
    try:

        # ── add_column_header: add a new column header if not present ─────────
        if op_type == 'add_column_header':
            tab = op['tab']
            header = op['header']
            headers = get_headers(tab)
            if header not in headers:
                col = col_letter(len(headers))
                ss.values().update(
                    spreadsheetId=sheet_id,
                    range=f'{tab}!{col}1',
                    valueInputOption='RAW',
                    body={'values': [[header]]}
                ).execute()
                results.append(f'✅ add_column_header: Added "{header}" to {tab} at col {col}')
            else:
                results.append(f'✅ add_column_header: "{header}" already exists in {tab}')

        # ── update_cell_by_id: update field(s) on a row matched by ID col ─────
        elif op_type == 'update_cell_by_id':
            tab = op['tab']
            row_id = str(op['id'])
            fields = op['fields']  # dict of {column_name: value}
            all_rows = get_all_rows(tab)
            if not all_rows:
                results.append(f'❌ update_cell_by_id: Tab {tab} is empty')
                continue
            headers = all_rows[0]
            # The key column is NOT always index 0. On Work_Orders, column 0 is
            # Vendor_Needs_Access and the real "ID" column sits at index 1, so
            # matching r[0] compared against a blank column and never matched.
            id_col = headers.index('ID') if 'ID' in headers else 0
            row_idx = next((i for i, r in enumerate(all_rows[1:], 1)
                            if r and len(r) > id_col and r[id_col] == row_id), None)
            if row_idx is None:
                results.append(f'❌ update_cell_by_id: Row ID {row_id} not found in {tab}')
                continue
            sheet_row = row_idx + 1
            updates = []
            for field, value in fields.items():
                if field in headers:
                    col_idx = headers.index(field)
                    updates.append({'range': f'{tab}!{col_letter(col_idx)}{sheet_row}', 'values': [[str(value)]]})
                else:
                    results.append(f'⚠️  update_cell_by_id: Column "{field}" not found in {tab} headers')
            if updates:
                ss.values().batchUpdate(
                    spreadsheetId=sheet_id,
                    body={'valueInputOption': 'RAW', 'data': updates}
                ).execute()
                results.append(f'✅ update_cell_by_id: Updated row ID {row_id} in {tab}: {list(fields.keys())}')

        # ── create_tab: create a new sheet tab if it doesn't exist ───────────
        elif op_type == 'create_tab':
            tab = op['tab']
            existing = get_tab_names()
            if tab not in existing:
                ss.batchUpdate(
                    spreadsheetId=sheet_id,
                    body={'requests': [{'addSheet': {'properties': {'title': tab}}}]}
                ).execute()
                results.append(f'✅ create_tab: Created tab "{tab}"')
            else:
                results.append(f'✅ create_tab: Tab "{tab}" already exists')

        # ── write_headers: write header row to a tab if it's empty ───────────
        elif op_type == 'write_headers':
            tab = op['tab']
            headers = op['headers']
            existing = ss.values().get(spreadsheetId=sheet_id, range=tab).execute()
            if not existing.get('values'):
                ss.values().append(
                    spreadsheetId=sheet_id,
                    range=f'{tab}!A1',
                    valueInputOption='RAW',
                    body={'values': [headers]}
                ).execute()
                results.append(f'✅ write_headers: Wrote {len(headers)} headers to {tab}')
            else:
                results.append(f'✅ write_headers: {tab} already has content — skipped')

        # ── append_row: append a new row to a tab ────────────────────────────
        elif op_type == 'append_row':
            tab = op['tab']
            row_data = op['row']  # dict of {column: value}
            all_rows = get_all_rows(tab)
            headers = all_rows[0] if all_rows else list(row_data.keys())
            new_row = [str(row_data.get(h, '')) for h in headers]
            ss.values().append(
                spreadsheetId=sheet_id,
                range=f'{tab}!A1',
                valueInputOption='RAW',
                body={'values': [new_row]}
            ).execute()
            results.append(f'✅ append_row: Appended row to {tab}')

        # ── set_cell: write a value to a specific range ───────────────────────
        elif op_type == 'set_cell':
            range_str = op['range']
            value = op['value']
            ss.values().update(
                spreadsheetId=sheet_id,
                range=range_str,
                valueInputOption='RAW',
                body={'values': [[str(value)]]}
            ).execute()
            results.append(f'✅ set_cell: Set {range_str} = {value}')

        else:
            results.append(f'⚠️  Unknown op type: {op_type}')

    except Exception as e:
        results.append(f'❌ {op_type} failed: {e}')

# ── Print results ─────────────────────────────────────────────────────────────
print('\n--- RESULTS ---')
for r in results:
    print(r)

failed = [r for r in results if r.startswith('❌')]
if failed:
    print(f'\n{len(failed)} operation(s) failed.')
    sys.exit(1)
else:
    print(f'\nAll {len(results)} operation(s) succeeded.')
