"""Create the administrator through the compiled command's real prompts.

Usage: standalone-admin.py /path/to/raphie email password   (scratch data only)
"""
import os, pty, select, sys, time

command, email, password = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(command, [command, "auth", "setup"])
seen = b""
for prompt, answer in ((b"email:", email), (b"New password", password), (b"Repeat password", password)):
    deadline = time.monotonic() + 30
    while prompt not in seen:
        if time.monotonic() > deadline:
            raise SystemExit("The auth prompt did not appear.")
        if select.select([fd], [], [], 0.25)[0]:
            chunk = os.read(fd, 4096)
            if not chunk:
                raise SystemExit("The auth command ended early.")
            seen += chunk
    seen = b""
    os.write(fd, answer.encode() + b"\r")
while select.select([fd], [], [], 5)[0]:
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    seen += chunk
code = os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1])
if code or password.encode() in seen:
    raise SystemExit("Administrator setup failed or echoed the password.")
