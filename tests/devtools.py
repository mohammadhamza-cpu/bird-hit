"""Dependency-free local Chromium DevTools client, reused from the Tetris harness.
Only controls the temporary browser process launched by browser_test.py.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import time
from urllib.parse import urlparse


class DevTools:
    def __init__(self, url):
        endpoint = urlparse(url)
        self.socket = socket.create_connection((endpoint.hostname, endpoint.port), timeout=15)
        self.buffer = b''
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET {endpoint.path} HTTP/1.1\r\nHost: {endpoint.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        while b'\r\n\r\n' not in self.buffer:
            self.buffer += self.socket.recv(4096)
        headers, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
        expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if headers.split(b'\r\n', 1)[0].split()[1] != b'101' or expected not in headers:
            raise RuntimeError(f'WebSocket handshake failed: {headers!r}')
        self.serial = 0
        self.events = []

    def read(self, count):
        while len(self.buffer) < count:
            chunk = self.socket.recv(max(4096, count - len(self.buffer)))
            if not chunk:
                raise RuntimeError('Browser disconnected')
            self.buffer += chunk
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def send(self, payload, opcode=1):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack('!H', length)
        else:
            header += bytes([0x80 | 127]) + struct.pack('!Q', length)
        self.socket.sendall(header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))

    def receive(self):
        fragments = b''
        while True:
            first, second = self.read(2)
            length = second & 127
            if length == 126:
                length = struct.unpack('!H', self.read(2))[0]
            elif length == 127:
                length = struct.unpack('!Q', self.read(8))[0]
            mask = self.read(4) if second & 128 else None
            payload = self.read(length)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            opcode = first & 15
            if opcode == 8:
                raise RuntimeError('WebSocket closed')
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            fragments += payload
            if first & 128:
                return json.loads(fragments)

    def call(self, method, **params):
        self.serial += 1
        request_id = self.serial
        self.send(json.dumps({'id': request_id, 'method': method, 'params': params}).encode())
        while True:
            response = self.receive()
            if response.get('id') == request_id:
                if 'error' in response:
                    raise RuntimeError(f'{method}: {response["error"]}')
                return response.get('result', {})
            self.events.append(response)

    def js(self, expression):
        result = self.call('Runtime.evaluate', expression=expression, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in result:
            raise RuntimeError(json.dumps(result['exceptionDetails']))
        return result.get('result', {}).get('value')

    def wait(self, expression, timeout=6):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.js(expression):
                return
            time.sleep(.025)
        raise AssertionError(f'Timed out waiting for {expression}')

    def navigate(self, path):
        self.call('Page.navigate', url=Path(path).as_uri())
        self.wait("document.readyState === 'complete' && Boolean(window.SkyshotApp || window.SkyshotTestResults)")

    def key(self, code, hold=0, repeat=False):
        values = {'ArrowLeft':37, 'ArrowRight':39, 'ArrowDown':40, 'ArrowUp':38, 'Space':32, 'Escape':27, 'Enter':13}
        virtual = values.get(code, ord(code[-1]) if code.startswith('Key') else 0)
        key = code[-1].lower() if code.startswith('Key') else ' ' if code == 'Space' else code
        character = ' ' if code == 'Space' else '\r' if code == 'Enter' else ''
        params = dict(code=code, key=key, windowsVirtualKeyCode=virtual, nativeVirtualKeyCode=virtual)
        self.call('Input.dispatchKeyEvent', type='keyDown', autoRepeat=repeat, text=character, unmodifiedText=character, **params)
        if hold:
            time.sleep(hold)
        self.call('Input.dispatchKeyEvent', type='keyUp', **params)
        time.sleep(.025)

    def click_at(self, x, y):
        self.call('Input.dispatchMouseEvent', type='mouseMoved', x=x, y=y)
        self.call('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
        self.call('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)

    def point(self, selector):
        return self.js(f"(() => {{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()")

    def click(self, selector):
        self.click_at(**self.point(selector))
        time.sleep(.035)

    def screenshot(self, path):
        image = self.call('Page.captureScreenshot', format='png', captureBeyondViewport=True)
        Path(path).write_bytes(base64.b64decode(image['data']))
