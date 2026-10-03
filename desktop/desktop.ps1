param(
    [ValidateSet('attach', 'detach', 'inspect', 'place', 'contextmenu')][string]$Action = 'inspect',
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{1,20}$')][string]$Hwnd,
    [Parameter(Mandatory = $true)][int]$OwnerProcessId,
    [string]$StateBase64 = '',
    [ValidateRange(0.35, 1.0)][double]$Opacity = 1.0,
    [int]$Left = 0,
    [int]$Top = 0,
    [ValidateRange(200, 10000)][int]$Width = 900,
    [ValidateRange(180, 10000)][int]$Height = 410
)

# This helper only changes the supplied application's window. It never moves,
# hides, destroys or restyles Explorer windows or desktop icons.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class ShiriDesktop {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int Dx, Dy; public uint MouseData, Flags, Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint Type; public MOUSEINPUT Mouse; }
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr data);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] static extern IntPtr GetLong64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)] static extern int GetLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] static extern IntPtr SetLong64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] static extern int SetLong32(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetParent(IntPtr hwnd, IntPtr parent);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool ScreenToClient(IntPtr hwnd, ref POINT point);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT point, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint color, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);

    public static string ClassName(IntPtr hwnd) { var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity); return name.ToString(); }
    public static long ReadStyle(IntPtr hwnd, int index) { return IntPtr.Size == 8 ? (long)unchecked((uint)GetLong64(hwnd, index).ToInt64()) : (long)(uint)GetLong32(hwnd, index); }
    public static void WriteStyle(IntPtr hwnd, int index, long value) {
        SetLastError(0);
        IntPtr previous = IntPtr.Size == 8 ? SetLong64(hwnd, index, new IntPtr(value)) : new IntPtr(SetLong32(hwnd, index, unchecked((int)value)));
        int error = Marshal.GetLastWin32Error();
        if (previous == IntPtr.Zero && error != 0) throw new Win32Exception(error, "Unable to change application window style");
    }
    public static void Parent(IntPtr hwnd, IntPtr parent) {
        SetLastError(0);
        IntPtr previous = SetParent(hwnd, parent);
        int error = Marshal.GetLastWin32Error();
        if (previous == IntPtr.Zero && error != 0) throw new Win32Exception(error, "Unable to attach application window (DPI or shell incompatibility)");
        if (GetParent(hwnd) != parent) throw new InvalidOperationException("Window parent verification failed");
    }
    public static void AssertOwner(IntPtr hwnd, int processId) {
        uint actual; GetWindowThreadProcessId(hwnd, out actual);
        if (!IsWindow(hwnd) || actual != (uint)processId) throw new InvalidOperationException("Application window no longer exists or owner changed");
    }
    static bool IsExplorer(IntPtr hwnd) {
        try { uint pid; GetWindowThreadProcessId(hwnd, out pid); return Process.GetProcessById((int)pid).ProcessName.Equals("explorer", StringComparison.OrdinalIgnoreCase); } catch { return false; }
    }
    public static IntPtr DesktopHost() {
        // On classic Windows the icon host is WorkerW. On the raised desktop in
        // Windows 11 24H2+ it is Progman. We need the icon host, not the wallpaper
        // WorkerW behind its ListView, so that the calendar can receive input.
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr candidate, IntPtr unused) {
            string cls = ClassName(candidate);
            if ((cls == "WorkerW" || cls == "Progman") && IsExplorer(candidate) &&
                FindWindowEx(candidate, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
                found = candidate; return false;
            }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) {
            // Desktop icons can be disabled while Progman remains the shell host.
            IntPtr progman = FindWindow("Progman", null);
            if (progman != IntPtr.Zero && IsExplorer(progman)) found = progman;
        }
        if (found == IntPtr.Zero) throw new InvalidOperationException("Compatible Explorer desktop host was not found");
        return found;
    }
    public static void UsePhysicalCoordinates() {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    }
    public static RECT PrimaryWorkArea() {
        // Use physical coordinates consistently, including monitors with scaled DPI.
        UsePhysicalCoordinates();
        var info = new MONITORINFO(); info.Size = Marshal.SizeOf(typeof(MONITORINFO));
        var origin = new POINT();
        if (!GetMonitorInfo(MonitorFromPoint(origin, 1), ref info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return info.Work;
    }
    public static void Place(IntPtr hwnd, IntPtr parent, RECT rect) {
        var origin = new POINT(); origin.X = rect.Left; origin.Y = rect.Top;
        if (parent != IntPtr.Zero && !ScreenToClient(parent, ref origin)) throw new Win32Exception(Marshal.GetLastWin32Error());
        // HWND_TOP is within the desktop parent's children; never an always-on-top window.
        if (!SetWindowPos(hwnd, IntPtr.Zero, origin.X, origin.Y, rect.Right - rect.Left, rect.Bottom - rect.Top, 0x0070))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unable to position application window");
    }
    public static RECT WidgetRect(int left, int top, int width, int height) {
        var work = PrimaryWorkArea();
        // Electron's DIP-to-physical conversion may round a full-width window
        // one or two pixels beyond the exact Win32 work area at scaled DPI.
        if (Math.Abs(width - (work.Right - work.Left)) <= 2 &&
            Math.Abs(height - (work.Bottom - work.Top)) <= 2) return work;
        if (width > work.Right - work.Left || height > work.Bottom - work.Top)
            throw new InvalidOperationException(string.Format("Desktop calendar is larger than the primary work area ({0}x{1} requested, {2}x{3} available)", width, height, work.Right - work.Left, work.Bottom - work.Top));
        var rect = new RECT();
        rect.Left = Math.Max(work.Left, Math.Min(left, work.Right - width));
        rect.Top = Math.Max(work.Top, Math.Min(top, work.Bottom - height));
        rect.Right = rect.Left + width;
        rect.Bottom = rect.Top + height;
        return rect;
    }
    public static void ForwardDesktopRightClick() {
        var inputs = new INPUT[2];
        inputs[0].Mouse.Flags = 0x0008; // MOUSEEVENTF_RIGHTDOWN
        inputs[1].Mouse.Flags = 0x0010; // MOUSEEVENTF_RIGHTUP
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not forward desktop context menu");
    }
}
'@

    [ShiriDesktop]::UsePhysicalCoordinates()
    $targetWindow = [IntPtr]::new([Int64]::Parse($Hwnd))
    [ShiriDesktop]::AssertOwner($targetWindow, $OwnerProcessId)

    if ($Action -eq 'contextmenu') {
        [ShiriDesktop]::ForwardDesktopRightClick()
        @{ ok = $true; forwarded = $true } | ConvertTo-Json -Compress
        exit 0
    }

    if ($Action -eq 'inspect') {
        $currentParent = [ShiriDesktop]::GetParent($targetWindow)
        @{ ok = $true; parent = $currentParent.ToInt64().ToString(); parentClass = [ShiriDesktop]::ClassName($currentParent) } | ConvertTo-Json -Compress
        exit 0
    }

    if ($Action -eq 'place') {
        $desktopHost = [ShiriDesktop]::DesktopHost()
        if ([ShiriDesktop]::GetParent($targetWindow) -ne $desktopHost) { throw 'Calendar is not attached to the current desktop host' }
        $rect = [ShiriDesktop]::WidgetRect($Left, $Top, $Width, $Height)
        [ShiriDesktop]::Place($targetWindow, $desktopHost, $rect)
        @{ ok = $true; placed = $true; left = $rect.Left; top = $rect.Top; width = $Width; height = $Height } | ConvertTo-Json -Compress
        exit 0
    }

    if ($Action -eq 'detach') {
        if (-not $StateBase64 -or $StateBase64.Length -gt 8192) { throw 'Missing or invalid restore state' }
        $restoreState = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($StateBase64)) | ConvertFrom-Json
        if ($restoreState.hwnd -ne $Hwnd -or [int]$restoreState.processId -ne $OwnerProcessId) { throw 'Restore state does not match the application window' }
        $originalParent = [IntPtr]::new([Int64]::Parse([string]$restoreState.parent))
        if ($originalParent -ne [IntPtr]::Zero -and -not [ShiriDesktop]::IsWindow($originalParent)) { $originalParent = [IntPtr]::Zero }
        [ShiriDesktop]::Parent($targetWindow, $originalParent)
        [ShiriDesktop]::WriteStyle($targetWindow, -16, [Int64]::Parse([string]$restoreState.style))
        [ShiriDesktop]::WriteStyle($targetWindow, -20, [Int64]::Parse([string]$restoreState.exStyle))
        $restoreRect = New-Object ShiriDesktop+RECT
        $restoreRect.Left = [int]$restoreState.left; $restoreRect.Top = [int]$restoreState.top
        $restoreRect.Right = [int]$restoreState.right; $restoreRect.Bottom = [int]$restoreState.bottom
        [ShiriDesktop]::Place($targetWindow, $originalParent, $restoreRect)
        @{ ok = $true; detached = $true } | ConvertTo-Json -Compress
        exit 0
    }

    $desktopHost = [ShiriDesktop]::DesktopHost()
    $windowRect = New-Object ShiriDesktop+RECT
    if (-not [ShiriDesktop]::GetWindowRect($targetWindow, [ref]$windowRect)) { throw 'Could not read application window bounds' }
    $savedState = @{
        hwnd = $Hwnd; processId = $OwnerProcessId
        parent = [ShiriDesktop]::GetParent($targetWindow).ToInt64().ToString()
        style = [ShiriDesktop]::ReadStyle($targetWindow, -16).ToString()
        exStyle = [ShiriDesktop]::ReadStyle($targetWindow, -20).ToString()
        left = $windowRect.Left; top = $windowRect.Top; right = $windowRect.Right; bottom = $windowRect.Bottom
    }

    try {
        # Clear popup/caption/frame/system buttons and set WS_CHILD on our HWND only.
        $childStyle = ([Int64]::Parse($savedState.style) -band (-bnot [Convert]::ToInt64('A1CF0000', 16))) -bor [Int64]0x40000000
        $childExStyle = ([Int64]::Parse($savedState.exStyle) -band (-bnot [Int64]0x08040020)) -bor [Int64]0x00080080
        [ShiriDesktop]::WriteStyle($targetWindow, -16, $childStyle)
        [ShiriDesktop]::WriteStyle($targetWindow, -20, $childExStyle)
        [ShiriDesktop]::Parent($targetWindow, $desktopHost)
        if (-not [ShiriDesktop]::SetLayeredWindowAttributes($targetWindow, 0, [byte][Math]::Round(255 * $Opacity), 2)) { throw 'Could not composite the desktop window' }
        $widgetRect = [ShiriDesktop]::WidgetRect($Left, $Top, $Width, $Height)
        [ShiriDesktop]::Place($targetWindow, $desktopHost, $widgetRect)
        @{ ok = $true; host = [ShiriDesktop]::ClassName($desktopHost); hostHwnd = $desktopHost.ToInt64().ToString(); state = $savedState; iconLayer = 'calendar-above-icons' } | ConvertTo-Json -Depth 5 -Compress
    } catch {
        $attachError = $_.Exception.Message
        $rollbackError = $null
        try {
            [ShiriDesktop]::Parent($targetWindow, [IntPtr]::new([Int64]::Parse($savedState.parent)))
            [ShiriDesktop]::WriteStyle($targetWindow, -16, [Int64]::Parse($savedState.style))
            [ShiriDesktop]::WriteStyle($targetWindow, -20, [Int64]::Parse($savedState.exStyle))
            [ShiriDesktop]::Place($targetWindow, [IntPtr]::new([Int64]::Parse($savedState.parent)), $windowRect)
        } catch { $rollbackError = $_.Exception.Message }
        @{ ok = $false; error = $attachError; rollbackError = $rollbackError; state = $savedState } | ConvertTo-Json -Depth 5 -Compress
        exit 1
    }
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
