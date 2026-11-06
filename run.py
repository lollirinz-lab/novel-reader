import os
import sys
import socket
import qrcode
import uvicorn
from pathlib import Path

APP_DIR = Path(__file__).parent.resolve()

def get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def main():
    lan_ip = get_lan_ip()
    port = int(os.environ.get("PORT", 8000))
    network_url = f"http://{lan_ip}:{port}"
    local_url = f"http://localhost:{port}"

    print("=" * 64)
    print(" 📖 เสียงหวานนิยาย - PWA Audio Novel Reader (Edge-TTS)")
    print("=" * 64)
    print(f" 💻 บนคอมพิวเตอร์ของคุณ : {local_url}")
    print(f" 📱 บน iPhone / Android  : {network_url}")
    print("=" * 64)
    print(" 📲 สแกน QR Code ด้านล่างด้วยกล้องมือถือ เพื่อเปิดบน iOS/Android ได้ทันที:")
    print()

    # Generate ASCII QR Code in terminal
    try:
        qr = qrcode.QRCode(border=1)
        qr.add_data(network_url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except Exception as e:
        print(f" (QR generator note: {e})")

    print()
    print(" ✨ ปิดหน้านี้เมื่อต้องการหยุดเซิร์ฟเวอร์ (Ctrl+C)")
    print("=" * 64)
    print()

    # Run uvicorn server
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info", reload=False)

if __name__ == "__main__":
    main()
