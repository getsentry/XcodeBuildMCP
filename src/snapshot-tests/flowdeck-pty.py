"""Spawn flowdeck inside a PTY so it emits full ANSI colour sequences."""
import os
import pty
import subprocess
import sys

def main():
    master, slave = pty.openpty()
    env = dict(os.environ, TERM="xterm-256color", COLUMNS="120", LINES="50")
    p = subprocess.Popen(
        ["flowdeck"] + sys.argv[1:],
        stdout=slave,
        stderr=slave,
        stdin=slave,
        env=env,
        close_fds=True,
    )
    os.close(slave)

    output = b""
    while True:
        try:
            data = os.read(master, 4096)
            if not data:
                break
            output += data
        except OSError:
            break

    os.close(master)
    rc = p.wait()
    sys.stdout.buffer.write(output)
    sys.exit(rc)

if __name__ == "__main__":
    main()
