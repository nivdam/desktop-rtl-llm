set homePath to POSIX path of (path to home folder)
set runner to quoted form of (homePath & "Library/Application Support/rtl-desktop-runtime/run-rtl.sh")

do shell script runner & " codex >/dev/null 2>&1 &"
