// The WhatsApp number this device sends bills from (linked in Settings → WhatsApp). Kept on the device
// itself, so every phone or computer that uses Gemini can send from its own WhatsApp number.
const KEY = 'gemini-whatsapp-sender'

export function deviceSender() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function setDeviceSender(number) {
  try {
    if (number) localStorage.setItem(KEY, String(number))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: the main linked number is used */
  }
}
