# Send bill PDFs straight to WhatsApp

When this is set up, **Share → WhatsApp** on a bill or payment sends the PDF straight to the party's
mobile number on WhatsApp. You don't search for the contact or attach anything. Gemini needs
internet only at the moment it sends.

This uses Meta's **WhatsApp Business Platform (Cloud API)**. You do the setup below once, in your
own Meta account. Gemini never sees your Facebook password.

## What you need

- A Facebook account and a **Meta Business** account (free): https://business.facebook.com
- A **phone number for sending** that is *not* already logged in to the normal WhatsApp or
  WhatsApp Business app (or one you are ready to move to the API). Customers see messages from this number.
- A **payment method** in Meta. Template messages are charged per message by Meta; see the current
  rates for India in WhatsApp Manager → Insights / Billing.

## Steps

1. **Create the app**
   - Go to https://developers.facebook.com → *My Apps* → **Create app** → choose **Business**.
   - In the app, add the product **WhatsApp** and link it to your Meta Business account.

2. **Add your sending number**
   - WhatsApp → **API Setup** → *Add phone number* → enter your business name and number, verify it with the code.
   - On the same page copy the **Phone number ID** (a long number, *not* the phone number itself).

3. **Make a permanent access token**
   - Meta Business Settings → **Users → System users** → *Add* (role **Admin**).
   - *Add assets* → your app (full control) and your WhatsApp account (full control).
   - **Generate new token** → choose your app → expiry **Never** → tick
     `whatsapp_business_messaging` and `whatsapp_business_management` → copy the token.
     Keep it secret, like a password.

4. **Create the message template** (Meta must approve it, usually within minutes)
   - WhatsApp Manager → **Message templates** → **Create template**.
   - Category **Utility**, name **invoice_pdf**, language **English**.
   - **Header: Document**.
   - **Body** with 3 variables, for example:
     `Hello {{1}}, your bill {{2}} for {{3}} is attached. Thank you for your business!`
   - Submit and wait until the status is **Active / Approved**.

5. **Put the details in Gemini**
   - Open the file `.env` in this Gemini folder with Notepad and fill in:
     ```
     WHATSAPP_TOKEN=paste the token from step 3
     WHATSAPP_PHONE_NUMBER_ID=paste the Phone number ID from step 2
     WHATSAPP_TEMPLATE=invoice_pdf
     WHATSAPP_TEMPLATE_LANGUAGE=en
     WHATSAPP_TEMPLATE_PARAMS=party,number,amount
     ```
   - Save the file, then restart Gemini: in this folder run
     `backend\venv\Scripts\python.exe scripts\runner.py restart`
     (or restart the PC and double-click **Start Gemini.bat**).

6. **Use it**
   - Open a bill → **Share** → **WhatsApp (Send PDF)**. You'll see
     *"PDF sent on WhatsApp to +91…"*. The party's mobile number must be saved in the party.

## Template variables

`WHATSAPP_TEMPLATE_PARAMS` lists what goes into the template body's `{{1}}`, `{{2}}`, … in order.
It must have exactly as many entries as the template has variables. Choose from:

| Name | What it fills in |
|---|---|
| `party` | Party name |
| `number` | Bill / receipt number, e.g. Bil.2 |
| `amount` | Bill total or payment amount, e.g. ₹15,300.00 |
| `balance` | Balance due on the bill |
| `date` | Bill / payment date |
| `business` | Your business name |

If you use a template in Gujarati, set `WHATSAPP_TEMPLATE_LANGUAGE=gu`. Use the same name and
language as the approved template.

## If it does not send

The message Gemini shows comes from WhatsApp. The common ones:

- **"Template name does not exist in the translation"**: the template name or language in `.env` is not
  exactly the approved one (or it is not approved yet).
- **"Number of parameters does not match"**: `WHATSAPP_TEMPLATE_PARAMS` has a different count than
  the `{{ }}` variables in the template body.
- **"Recipient phone number not in allowed list"**: you are still using Meta's free *test* number,
  which can send only to numbers you added on the API Setup page. Add your real number (step 2).
- **"Authentication error" / "Session has expired"**: the token is wrong or expired. Make a
  never-expiring system-user token (step 3).
- **"Could not reach WhatsApp"**: the PC has no internet at that moment.

Until `.env` has these details, the WhatsApp button works the old way and opens a WhatsApp chat
with a message and link.
