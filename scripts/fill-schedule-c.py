"""
Fills the blank IRS Schedule C with a fictional sole proprietorship, so the
demo file has something on it to read.

Every cross-reference on the form reconciles: line 4 equals line 42, line 27b
equals line 48, line 28 is the sum of lines 8 through 27b, and Part III adds
up to the cost of goods sold it feeds. That is deliberate — this file's job is
to be a dense real government form whose internal arithmetic the agent can
check and confirm. The file with a wrong total is calder-revenue-bad-total.pdf.

The SSN is 987-65-4321, which the SSA reserves for demonstration use and never
issues, so no real person's number appears on a form that says it is theirs.
"""
from pypdf import PdfReader, PdfWriter

SRC = 'irs-schedule-c.pdf'
OUT = 'irs-schedule-c.pdf'

money = lambda n: f'{n:,}'

# ---------------------------------------------------------------- Part I
gross_receipts = 184_250
returns        = 2_140
line3          = gross_receipts - returns

# ---------------------------------------------------------------- Part III
inv_start   = 12_300
purchases   = 44_870
cost_labour = 6_500
materials   = 14_210
other_costs = 2_900
line40      = inv_start + purchases + cost_labour + materials + other_costs
inv_end     = 19_300
cogs        = line40 - inv_end            # line 42, and line 4

gross_profit = line3 - cogs
other_income = 1_875
gross_income = gross_profit + other_income   # line 7

# ---------------------------------------------------------------- Part V
other_expenses = [
    ('Bookbinding tool sharpening and repair', 780),
    ('Trade association dues', 295),
    ('Continuing education - conservation workshop', 1_150),
    ('Studio waste removal and recycling', 640),
    ('Software subscriptions', 1_020),
    ('Bank and merchant processing fees', 1_485),
    ('Postage and shipping supplies', 865),
    ('Business licences and permits', 200),
]
line48 = sum(amount for _, amount in other_expenses)   # and line 27b

# ------------------------------------------------------- Part II expenses
# (form line -> amount). Blank lines are simply absent.
expenses = {
    '8':   3_420,   # Advertising
    '9':   4_865,   # Car and truck
    '11':  7_200,   # Contract labor
    '13':  8_940,   # Depreciation and section 179
    '15':  2_760,   # Insurance
    '16b': 1_310,   # Other interest
    '17':  2_150,   # Legal and professional
    '18':  1_845,   # Office expense
    '20a': 3_600,   # Rent - vehicles, machinery, equipment
    '20b': 18_000,  # Rent - other business property
    '21':  2_485,   # Repairs and maintenance
    '22':  5_930,   # Supplies
    '23':  3_275,   # Taxes and licenses
    '24a': 1_940,   # Travel
    '24b': 610,     # Deductible meals
    '25':  4_120,   # Utilities
    '26':  21_500,  # Wages
    '27b': line48,  # Other expenses, from line 48
}
total_expenses    = sum(expenses.values())          # line 28
tentative_profit  = gross_income - total_expenses   # line 29
home_sqft, business_sqft = 1_450, 240
home_office       = business_sqft * 5               # simplified method, line 30
net_profit        = tentative_profit - home_office  # line 31

P1 = 'topmostSubform[0].Page1[0].'
P2 = 'topmostSubform[0].Page2[0].'

page1 = {
    P1 + 'f1_1[0]': 'Dana R. Whitfield',
    P1 + 'f1_2[0]': '987-65-4321',
    P1 + 'f1_3[0]': 'Hand bookbinding, letterpress printing and paper conservation',
    P1 + 'BComb[0].f1_4[0]': '323100',
    P1 + 'f1_5[0]': 'Alder & Finch Bindery',
    P1 + 'DComb[0].f1_6[0]': '990432187',
    P1 + 'f1_7[0]': '118 Kilnwood Road, Suite 4',
    P1 + 'f1_8[0]': 'Providence, RI 02909',

    # Part I
    P1 + 'f1_10[0]': money(gross_receipts),
    P1 + 'f1_11[0]': money(returns),
    P1 + 'f1_12[0]': money(line3),
    P1 + 'f1_13[0]': money(cogs),
    P1 + 'f1_14[0]': money(gross_profit),
    P1 + 'f1_15[0]': money(other_income),
    P1 + 'f1_16[0]': money(gross_income),

    # Part II, and the two totals under it
    P1 + 'f1_41[0]': money(total_expenses),
    P1 + 'f1_42[0]': money(tentative_profit),
    P1 + 'Line30_ReadOrder[0].f1_43[0]': money(home_sqft),
    P1 + 'Line30_ReadOrder[0].f1_44[0]': str(business_sqft),
    P1 + 'f1_45[0]': money(home_office),
    P1 + 'f1_46[0]': money(net_profit),
}

# Part II runs down one column then the other, and the field order does not
# follow the line numbers at the end: 27a is f1_40 and 27b is f1_39.
EXPENSE_FIELDS = {
    '8':  'Lines8-17[0].f1_17[0]',   '9':   'Lines8-17[0].f1_18[0]',
    '10': 'Lines8-17[0].f1_19[0]',   '11':  'Lines8-17[0].f1_20[0]',
    '12': 'Lines8-17[0].f1_21[0]',   '13':  'Lines8-17[0].f1_22[0]',
    '14': 'Lines8-17[0].f1_23[0]',   '15':  'Lines8-17[0].f1_24[0]',
    '16a':'Lines8-17[0].f1_25[0]',   '16b': 'Lines8-17[0].f1_26[0]',
    '17': 'Lines8-17[0].f1_27[0]',
    '18': 'Lines18-27[0].f1_28[0]',  '19':  'Lines18-27[0].f1_29[0]',
    '20a':'Lines18-27[0].f1_30[0]',  '20b': 'Lines18-27[0].f1_31[0]',
    '21': 'Lines18-27[0].f1_32[0]',  '22':  'Lines18-27[0].f1_33[0]',
    '23': 'Lines18-27[0].f1_34[0]',  '24a': 'Lines18-27[0].f1_35[0]',
    '24b':'Lines18-27[0].f1_36[0]',  '25':  'Lines18-27[0].f1_37[0]',
    '26': 'Lines18-27[0].f1_38[0]',  '27a': 'Lines18-27[0].f1_40[0]',
    '27b':'Lines18-27[0].f1_39[0]',
}
for line, amount in expenses.items():
    page1[P1 + EXPENSE_FIELDS[line]] = money(amount)

page2 = {
    P2 + 'f2_1[0]': money(inv_start),
    P2 + 'f2_2[0]': money(purchases),
    P2 + 'f2_3[0]': money(cost_labour),
    P2 + 'f2_4[0]': money(materials),
    P2 + 'f2_5[0]': money(other_costs),
    P2 + 'f2_6[0]': money(line40),
    P2 + 'f2_7[0]': money(inv_end),
    P2 + 'f2_8[0]': money(cogs),

    # Part IV, vehicle
    P2 + 'f2_9[0]': '03', P2 + 'f2_10[0]': '14', P2 + 'f2_11[0]': '2022',
    P2 + 'f2_12[0]': '6,240', P2 + 'f2_13[0]': '1,180', P2 + 'f2_14[0]': '3,415',

    P2 + 'f2_33[0]': money(line48),
}
for i, (label, amount) in enumerate(other_expenses, start=1):
    item = f'{P2}PartVTable[0].Item{i}[0].'
    page2[item + f'f2_{13 + i * 2}[0]'] = label
    page2[item + f'f2_{14 + i * 2}[0]'] = money(amount)

# Checkboxes, by the export value in each widget's appearance dictionary.
ticks1 = {
    P1 + 'c1_1[0]': '/1',    # F. Cash accounting
    P1 + 'c1_2[0]': '/Yes',  # G. Materially participated
    P1 + 'c1_4[0]': '/Yes',  # I. Made payments requiring a 1099
    P1 + 'c1_5[0]': '/Yes',  # J. Will file them
}
ticks2 = {
    P2 + 'c2_1[0]': '/1',    # 33a. Inventory valued at cost
    P2 + 'c2_4[1]': '/2',    # 34.  No change in valuation method
    P2 + 'c2_5[0]': '/1',    # 45.  Vehicle available off-duty: Yes
    P2 + 'c2_6[0]': '/1',    # 46.  Another vehicle available: Yes
    P2 + 'c2_7[0]': '/1',    # 47a. Evidence to support the deduction: Yes
    P2 + 'c2_8[0]': '/1',    # 47b. That evidence is written: Yes
}

writer = PdfWriter(clone_from=SRC)
writer.update_page_form_field_values(writer.pages[0], {**page1, **ticks1}, auto_regenerate=True)
writer.update_page_form_field_values(writer.pages[1], {**page2, **ticks2}, auto_regenerate=True)
# Belt and braces: viewers that ignore our appearance streams rebuild their own.
writer.set_need_appearances_writer(True)
with open(OUT, 'wb') as fh:
    writer.write(fh)

print(f'line 3   gross less returns   {line3:>10,}')
print(f'line 4   = line 42 (COGS)     {cogs:>10,}')
print(f'line 5   gross profit         {gross_profit:>10,}')
print(f'line 7   gross income         {gross_income:>10,}')
print(f'line 27b = line 48            {line48:>10,}')
print(f'line 28  total expenses       {total_expenses:>10,}')
print(f'line 29  tentative profit     {tentative_profit:>10,}')
print(f'line 30  home office          {home_office:>10,}')
print(f'line 31  net profit           {net_profit:>10,}')
print(f'line 40  Part III subtotal    {line40:>10,}')
