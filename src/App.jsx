import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Camera,
  Bell,
  Volume2,
  VolumeX,
  Maximize2,
  Settings,
  Send,
  X,
  Download,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  Mail,
  Eye,
  RefreshCw,
  Video,
  User,
  SlidersHorizontal,
  TrendingUp,
  Lock,
  Unlock,
  Sparkles,
  Terminal,
  Clock
} from 'lucide-react';

export default function App() {
  // --- Runtime State ---
  const [isArmed, setIsArmed] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isIntrusionActive, setIsIntrusionActive] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [telemetry, setTelemetry] = useState({
    camera_fps: 30,
    is_mock_camera: false,
    zone_person_count: 0,
    consecutive_detections: 0,
    highest_confidence: 0,
    events_count: 0,
  });

  const [activeTab, setActiveTab] = useState('monitor'); // 'monitor' | 'incidents' | 'settings'
  const [recentEvents, setRecentEvents] = useState([]);
  const [auditLogs, setAuditLogs] = useState([
    { time: new Date().toLocaleTimeString(), tag: 'SYSTEM', msg: 'Argus AI Core initialized.', type: 'info' }
  ]);

  // Modals & Popups
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [lightboxData, setLightboxData] = useState(null);
  const [toast, setToast] = useState(null);

  // Settings form state
  const [settingsForm, setSettingsForm] = useState({
    smtp_server: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_recipient: '',
    email_cooldown_seconds: 45,
    confidence_threshold: 0.5,
    debounce_frames: 4,
  });

  const [isTestingEmail, setIsTestingEmail] = useState(false);

  // Audio Context Ref
  const audioCtxRef = useRef(null);
  const wsRef = useRef(null);
  const cooldownTimerRef = useRef(null);

  // --- Add Audit Log Helper ---
  const addAuditLog = (tag, msg, type = 'info') => {
    const timeStr = new Date().toLocaleTimeString();
    setAuditLogs((prev) => [{ time: timeStr, tag, msg, type }, ...prev.slice(0, 30)]);
  };

  // --- Web Audio Siren Synthesizer ---
  const playAlertSiren = () => {
    if (isAudioMuted) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }

      const now = audioCtxRef.current.currentTime;
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();

      osc.type = 'sawtooth';
      const duration = 2.4;
      for (let i = 0; i < 4; i++) {
        const t = now + i * 0.6;
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(659.25, t + 0.3);
      }

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  };

  // --- Toast Trigger ---
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // --- Cooldown Ticker ---
  const startCooldownTicker = (seconds) => {
    setCooldownRemaining(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    if (seconds <= 0) return;

    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // --- WebSocket Connection ---
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        addAuditLog('WS', 'Connected to real-time telemetry stream.', 'info');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'initial_state') {
            setIsArmed(msg.is_armed);
            startCooldownTicker(msg.cooldown_remaining || 0);
            if (msg.recent_events) setRecentEvents(msg.recent_events);
          } else if (msg.type === 'arm_state_changed') {
            setIsArmed(msg.is_armed);
            addAuditLog(
              'GUARD',
              msg.is_armed ? 'System ARMED: Active perimeter monitoring' : 'System DISARMED: Passive standby',
              msg.is_armed ? 'warning' : 'success'
            );
            showToast(
              msg.is_armed ? 'System ARMED' : 'System DISARMED',
              msg.is_armed ? 'warning' : 'success'
            );
          } else if (msg.type === 'intrusion_alert') {
            setIsIntrusionActive(true);
            playAlertSiren();
            addAuditLog(
              'BREACH',
              `Unauthorized human detected (${Math.round((msg.meta?.highest_confidence || 0.8) * 100)}% conf)`,
              'danger'
            );
            if (msg.event) {
              setRecentEvents((prev) => [msg.event, ...prev.slice(0, 24)]);
              if (msg.event.email_sent) startCooldownTicker(45);
            }
          } else if (msg.type === 'intrusion_cleared') {
            setIsIntrusionActive(false);
            addAuditLog('CLEAR', 'Monitored area is now clear.', 'success');
          }
        } catch (e) {
          console.error('WS message error:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [isAudioMuted]);

  // --- Polling Telemetry Backup ---
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setTelemetry(data);
      } catch (e) {
        // quiet error
      }
    };
    poll();
    const interval = setInterval(poll, 2500);
    return () => clearInterval(interval);
  }, []);

  // --- Load Settings on Mount ---
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        setSettingsForm({
          smtp_server: data.smtp_server || 'smtp.gmail.com',
          smtp_port: data.smtp_port || 587,
          smtp_username: data.smtp_username || '',
          smtp_password: data.smtp_password || '',
          smtp_recipient: data.smtp_recipient || '',
          email_cooldown_seconds: data.email_cooldown_seconds || 45,
          confidence_threshold: data.confidence_threshold || 0.5,
          debounce_frames: data.debounce_frames || 4,
        });
      } catch (e) {
        console.error('Could not load settings:', e);
      }
    };
    loadSettings();
  }, []);

  // --- Arm / Disarm Toggle ---
  const handleToggleArm = async () => {
    const nextState = !isArmed;
    try {
      const res = await fetch('/api/arm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ armed: nextState }),
      });
      const data = await res.json();
      if (data.success) {
        setIsArmed(data.is_armed);
      }
    } catch (e) {
      showToast('Failed to update system state', 'error');
    }
  };

  // --- Manual Snapshot ---
  const handleManualSnapshot = async () => {
    try {
      const res = await fetch('/api/manual-snapshot', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Snapshot captured', 'success');
        addAuditLog('SNAPSHOT', `Manual snapshot: ${data.snapshot_url}`, 'info');
        setRecentEvents((prev) => [
          {
            snapshot_url: data.snapshot_url,
            timestamp: data.timestamp,
            confidence: 1.0,
            status: 'MANUAL',
            person_count: 0,
          },
          ...prev,
        ]);
      }
    } catch (e) {
      showToast('Snapshot failed', 'error');
    }
  };

  // --- Test Email ---
  const handleTestEmail = async () => {
    setIsTestingEmail(true);
    try {
      const res = await fetch('/api/test-email', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        addAuditLog('SMTP', 'Test email dispatched successfully.', 'success');
      } else {
        showToast(data.message, 'error');
        addAuditLog('SMTP', `Test email failed: ${data.message}`, 'danger');
      }
    } catch (e) {
      showToast('Error dispatching test email', 'error');
    } finally {
      setIsTestingEmail(false);
    }
  };

  // --- Save Settings ---
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Configuration saved', 'success');
        addAuditLog('CONFIG', 'Updated detection and email parameters.', 'info');
        setIsSettingsOpen(false);
      }
    } catch (e) {
      showToast('Could not save settings', 'error');
    }
  };

  // Fullscreen video box
  const toggleFullscreen = () => {
    const el = document.getElementById('videoPlayerBox');
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const securityScore = isIntrusionActive ? 68 : isArmed ? 98 : 86;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#f4f5f8] text-slate-800 p-3 sm:p-4 select-none">
      
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-5 z-50 animate-bounce">
          <div
            className={`px-3.5 py-2.5 rounded-2xl shadow-soft-xl text-xs font-semibold flex items-center space-x-2 backdrop-blur-xl border ${
              toast.type === 'error'
                ? 'bg-rose-50/95 text-rose-700 border-rose-200'
                : toast.type === 'warning'
                ? 'bg-amber-50/95 text-amber-700 border-amber-200'
                : 'bg-emerald-50/95 text-emerald-700 border-emerald-200'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* TOP HEADER (Compact, Flush, Uses Full Width) */}
      <header className="h-12 w-full flex items-center justify-between px-2 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-2xl bg-white shadow-soft border border-slate-100 flex items-center justify-center text-slate-900 font-bold">
            <Shield className={`w-4 h-4 ${isArmed ? 'text-rose-500' : 'text-slate-700'}`} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-extrabold tracking-tight text-slate-900">Hello, Noah</h1>
              <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-white border border-slate-200 text-slate-600 shadow-sm">
                AI SENTINEL
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Smart Intrusion & Perimeter Overview</p>
          </div>
        </div>

        {/* Center Live Monitoring Indicator */}
        <div className="hidden md:flex items-center space-x-2">
          <div
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border transition ${
              isArmed
                ? 'bg-rose-50 text-rose-600 border-rose-200 shadow-glow-red animate-pulse'
                : 'bg-emerald-50 text-emerald-600 border-emerald-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full mr-2 ${
                isArmed ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'
              }`}
            />
            {isArmed ? 'ARMED PATROL ACTIVE' : 'PASSIVE STANDBY MODE'}
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center space-x-2">
          {/* Live Feed Status */}
          <div className="hidden sm:flex items-center px-2.5 py-1 rounded-full bg-white shadow-soft border border-slate-100 text-xs font-semibold text-slate-600">
            <span
              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            {isConnected ? 'LIVE FEED' : 'RECONNECTING'}
          </div>

          {/* Email Cooldown Pill */}
          <div className="hidden lg:flex items-center px-2.5 py-1 rounded-full bg-white shadow-soft border border-slate-100 text-xs font-mono font-semibold text-slate-600">
            <Mail className="w-3 h-3 mr-1 text-slate-400" />
            {cooldownRemaining > 0 ? (
              <span className="text-amber-600">CD: {cooldownRemaining}s</span>
            ) : (
              <span className="text-emerald-600">Ready</span>
            )}
          </div>

          {/* Notification Bell */}
          <button
            onClick={() => setActiveTab('incidents')}
            className="relative p-2 rounded-full bg-white shadow-soft border border-slate-100 text-slate-600 hover:text-slate-900 transition hover:scale-105 active:scale-95"
            title="Incidents"
          >
            <Bell className="w-3.5 h-3.5" />
            {recentEvents.length > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500 ring-2 ring-white" />
            )}
          </button>

          {/* Sound Toggle */}
          <button
            onClick={() => setIsAudioMuted(!isAudioMuted)}
            className="p-2 rounded-full bg-white shadow-soft border border-slate-100 text-slate-600 hover:text-slate-900 transition hover:scale-105 active:scale-95"
            title={isAudioMuted ? 'Unmute siren' : 'Mute siren'}
          >
            {isAudioMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-500" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Settings Trigger */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-full bg-white shadow-soft border border-slate-100 text-slate-600 hover:text-slate-900 transition hover:scale-105 active:scale-95"
            title="System Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* User Avatar */}
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shadow-soft ring-2 ring-white">
            N
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA (Takes remaining vertical height, zero document overflow) */}
      <main className="flex-1 min-h-0 w-full grid grid-cols-12 gap-3.5 mt-1 pb-1">
        
        {/* =========================================
            LEFT COLUMN: Smart Card & Controls (Col span 4)
            ========================================= */}
        <div className="col-span-12 lg:col-span-4 h-full flex flex-col gap-3 min-h-0">
          
          {/* 3 Metric Cards Strip */}
          <div className="grid grid-cols-3 gap-2 shrink-0">
            {/* Metric 1 */}
            <div className="bg-white rounded-2xl p-3 shadow-soft border border-slate-100/90 flex flex-col justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Mode</span>
              <div className="text-sm font-extrabold text-slate-900 truncate">
                {isArmed ? 'Patrol' : 'Passive'}
              </div>
              <span
                className={`w-fit mt-1 text-[9px] px-1.5 py-0.2 rounded-full font-bold border ${
                  isArmed ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                }`}
              >
                {isArmed ? '● Armed' : '● Standby'}
              </span>
            </div>

            {/* Metric 2 */}
            <div className="bg-white rounded-2xl p-3 shadow-soft border border-slate-100/90 flex flex-col justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Monitored</span>
              <div className="text-sm font-extrabold text-slate-900 truncate">
                {telemetry.zone_person_count || 0} <span className="text-[10px] font-normal text-slate-400">Target</span>
              </div>
              <span
                className={`w-fit mt-1 text-[9px] px-1.5 py-0.2 rounded-full font-bold border ${
                  isIntrusionActive ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                }`}
              >
                {isIntrusionActive ? '🚨 Breach' : '● Clear'}
              </span>
            </div>

            {/* Metric 3 */}
            <div className="bg-white rounded-2xl p-3 shadow-soft border border-slate-100/90 flex flex-col justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Email SMTP</span>
              <div className="text-sm font-extrabold text-slate-900 font-mono truncate">
                {cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'Ready'}
              </div>
              <span className="w-fit mt-1 text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-slate-100 text-slate-600">
                Rate-Limit
              </span>
            </div>
          </div>

          {/* Holographic Iridescent Smart Card (Ref Style) */}
          <div className="holographic-card rounded-[26px] p-4 shadow-soft-lg border border-white/70 text-slate-900 flex flex-col justify-between shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-indigo-800" />
                <span className="font-extrabold tracking-wider text-[11px] uppercase text-indigo-950">
                  Argus Sentinel Guard
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold bg-white/70 backdrop-blur-md px-2 py-0.5 rounded-full text-indigo-950 border border-white/50 shadow-sm">
                CAM-01 • 1080P
              </span>
            </div>

            <div className="my-2.5">
              <div className="text-[10px] font-semibold text-slate-700">Perimeter Status</div>
              <div className="text-base font-black tracking-tight text-slate-950 flex items-center gap-1.5">
                {isArmed ? 'ARMED // ACTIVE EVALUATION' : 'PASSIVE // MONITORING ONLY'}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2.5 border-t border-indigo-950/15">
              <div className="font-mono text-[11px] text-slate-800 font-medium">
                DEBOUNCE: <b>{telemetry.consecutive_detections || 0}/4 FRAMES</b>
              </div>

              {/* Master Arm / Disarm Toggle Button */}
              <button
                onClick={handleToggleArm}
                className={`px-4 py-1.5 rounded-full font-extrabold text-xs shadow-soft transition-all duration-300 flex items-center space-x-1.5 active:scale-95 ${
                  isArmed
                    ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-glow-red'
                    : 'bg-slate-900 hover:bg-black text-white'
                }`}
              >
                {isArmed ? (
                  <>
                    <Lock className="w-3 h-3" />
                    <span>DISARM</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3 h-3" />
                    <span>ARM GUARD</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Actions Squircle Row (Ref Style) */}
          <div className="bg-white rounded-2xl p-2.5 shadow-soft border border-slate-100 flex items-center justify-between gap-1 shrink-0">
            <button
              onClick={handleManualSnapshot}
              className="flex-1 flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-slate-50 transition group"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition">
                <Camera className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-semibold text-slate-600 mt-1">Snapshot</span>
            </button>

            <button
              onClick={() => setIsAudioMuted(!isAudioMuted)}
              className="flex-1 flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-slate-50 transition group"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition">
                {isAudioMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4" />}
              </div>
              <span className="text-[10px] font-semibold text-slate-600 mt-1">
                {isAudioMuted ? 'Unmute' : 'Mute'}
              </span>
            </button>

            <button
              onClick={handleTestEmail}
              disabled={isTestingEmail}
              className="flex-1 flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-slate-50 transition group"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition">
                {isTestingEmail ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </div>
              <span className="text-[10px] font-semibold text-slate-600 mt-1">Test Alert</span>
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex-1 flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-slate-50 transition group"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-semibold text-slate-600 mt-1">Config</span>
            </button>
          </div>

          {/* Incident Snapshots Gallery (Scrolls Internally If Needed) */}
          <div className="flex-1 min-h-0 bg-white rounded-[26px] p-3.5 shadow-soft border border-slate-100 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-xs font-bold text-slate-800">Incident Snapshots</span>
              <span className="text-[10px] font-semibold text-slate-400 font-mono">
                {recentEvents.length} Captured
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {recentEvents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 py-4">
                  <ShieldCheck className="w-8 h-8 opacity-30 text-emerald-500 mb-1" />
                  <div className="text-xs font-semibold">No Incidents Logged</div>
                  <span className="text-[10px]">Area is safe</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {recentEvents.slice(0, 12).map((ev, idx) => (
                    <div
                      key={idx}
                      onClick={() =>
                        setLightboxData({
                          url: ev.snapshot_url,
                          timestamp: ev.timestamp,
                          confidence: ev.confidence,
                        })
                      }
                      className="group relative rounded-xl overflow-hidden border border-slate-100 bg-slate-50 cursor-pointer hover:shadow-soft transition"
                    >
                      <img
                        src={ev.snapshot_url}
                        alt="Incident"
                        className="w-full h-16 object-cover group-hover:scale-105 transition duration-200"
                      />
                      <div className="p-1 bg-white text-[9px] font-mono flex justify-between text-slate-500">
                        <span>{ev.timestamp ? ev.timestamp.split(' ')[1] || ev.timestamp : ''}</span>
                        <span className="font-bold text-rose-500">
                          {Math.round((ev.confidence || 0.8) * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* =========================================
            CENTER COLUMN: Live Video Monitor (Col span 5)
            ========================================= */}
        <div className="col-span-12 lg:col-span-5 h-full flex flex-col min-h-0">
          <div className="bg-white rounded-[28px] p-3.5 shadow-soft border border-slate-100 flex flex-col h-full min-h-0">
            
            {/* Video Header Strip */}
            <div className="flex items-center justify-between mb-2.5 shrink-0">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-800">
                  <Video className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">Live Camera Feed</h3>
                  <p className="text-[10px] text-slate-400">Corner Room Monitoring Unit</p>
                </div>
              </div>

              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {telemetry.is_mock_camera ? 'SIMULATED CCTV' : 'V4L2 WEBCAM'}
                </span>
                <button
                  onClick={toggleFullscreen}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                  title="Fullscreen"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Video Container (Flexes to fill remaining space) */}
            <div
              id="videoPlayerBox"
              className="relative flex-1 min-h-0 w-full rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-slate-200/80 shadow-inner"
            >
              {/* Live MJPEG Stream */}
              <img
                src="/video_feed"
                alt="Live Monitoring Feed"
                className="w-full h-full object-contain"
              />

              {/* Dropping Breach Alert Pill */}
              {isIntrusionActive && (
                <div className="absolute top-3 inset-x-3 mx-auto max-w-sm bg-rose-600/95 backdrop-blur-xl text-white rounded-xl shadow-glow-red p-2.5 flex items-center justify-between border border-rose-400 animate-bounce">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-white" />
                    <div className="text-[11px] font-black tracking-wide">BREACH DETECTED!</div>
                  </div>
                  <div className="text-[10px] font-mono font-bold text-yellow-300">
                    {Math.round((telemetry.highest_confidence || 0.85) * 100)}% CONF
                  </div>
                </div>
              )}

              {/* Top-Left Floating Glass Pill */}
              <div className="absolute top-3 left-3 glass-pill rounded-full px-2.5 py-1 flex items-center space-x-1.5 text-[11px] font-bold text-slate-900">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isArmed ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                  }`}
                />
                <span>{isArmed ? 'ARMED' : 'PASSIVE'}</span>
              </div>

              {/* Top-Right Floating FPS Pill */}
              <div className="absolute top-3 right-3 glass-pill rounded-full px-2.5 py-1 text-[10px] font-mono font-bold text-slate-800">
                {telemetry.camera_fps || 30} FPS
              </div>

              {/* Bottom Telemetry Strip */}
              <div className="absolute bottom-3 inset-x-3 flex items-center justify-between pointer-events-none">
                <div className="glass-pill rounded-full px-2.5 py-1 text-[10px] font-mono text-slate-800 font-semibold pointer-events-auto">
                  DEBOUNCE: <span className="text-indigo-600">{telemetry.consecutive_detections || 0}/4</span>
                </div>

                <div className="flex items-center space-x-1.5 pointer-events-auto">
                  <button
                    onClick={handleManualSnapshot}
                    className="glass-pill rounded-full p-1.5 text-slate-700 hover:text-slate-950 transition hover:scale-105 active:scale-95"
                    title="Take Snapshot"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsAudioMuted(!isAudioMuted)}
                    className="glass-pill rounded-full p-1.5 text-slate-700 hover:text-slate-950 transition hover:scale-105 active:scale-95"
                    title="Toggle Siren"
                  >
                    {isAudioMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-500" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* =========================================
            RIGHT COLUMN: Perimeter Health & Audit Log (Col span 3)
            ========================================= */}
        <div className="col-span-12 lg:col-span-3 h-full flex flex-col gap-3 min-h-0">
          
          {/* Perimeter Health Arc (Ref Style: "Cash Flow Health") */}
          <div className="bg-white rounded-[26px] p-4 shadow-soft border border-slate-100 flex flex-col justify-between shrink-0">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-xs font-bold text-slate-900">Perimeter Health</h3>
                <p className="text-[10px] text-slate-400">AI Vision & System Integrity</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {securityScore}%
              </span>
            </div>

            {/* Semicircular Gauge (Ref style) */}
            <div className="relative flex flex-col items-center justify-center my-1">
              <svg className="w-40 h-22 overflow-visible" viewBox="0 0 200 110">
                <path
                  d="M 20 100 A 80 80 0 0 1 180 100"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="14"
                  strokeLinecap="round"
                />
                <path
                  d="M 20 100 A 80 80 0 0 1 180 100"
                  fill="none"
                  stroke={isIntrusionActive ? '#f43f5e' : isArmed ? '#6366f1' : '#10b981'}
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 * (1 - securityScore / 100)}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute top-9 text-center">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  {isIntrusionActive ? 'ALERT' : 'OPTIMAL'}
                </span>
                <div className="text-2xl font-black text-slate-900 tracking-tight">
                  {securityScore}/100
                </div>
              </div>
            </div>

            {/* Sub-Metrics 3 Columns */}
            <div className="grid grid-cols-3 gap-1 pt-2.5 border-t border-slate-100 text-center">
              <div>
                <div className="text-[9px] font-medium text-slate-400">FPS</div>
                <div className="text-xs font-bold text-slate-800">{telemetry.camera_fps || 30}</div>
              </div>
              <div>
                <div className="text-[9px] font-medium text-slate-400">Latency</div>
                <div className="text-xs font-bold text-slate-800">~14ms</div>
              </div>
              <div>
                <div className="text-[9px] font-medium text-slate-400">SMTP</div>
                <div className="text-xs font-bold text-indigo-600">
                  {cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'Idle'}
                </div>
              </div>
            </div>
          </div>

          {/* Audit Log Terminal (Flexes to fill bottom space) */}
          <div className="flex-1 min-h-0 bg-white rounded-[26px] p-3.5 shadow-soft border border-slate-100 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                Live Audit Stream
              </span>
              <span className="text-[9px] font-mono text-emerald-600 font-bold flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" /> STREAMING
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 font-mono text-[10px]">
              {auditLogs.map((log, idx) => (
                <div
                  key={idx}
                  className="flex items-start space-x-1.5 py-1 border-b border-slate-100/80 last:border-0"
                >
                  <span className="text-slate-400 text-[9px]">{log.time}</span>
                  <span
                    className={`px-1 py-0.2 rounded text-[8px] font-bold border ${
                      log.type === 'danger'
                        ? 'bg-rose-50 text-rose-600 border-rose-200'
                        : log.type === 'warning'
                        ? 'bg-amber-50 text-amber-600 border-amber-200'
                        : 'bg-indigo-50 text-indigo-600 border-indigo-200'
                    }`}
                  >
                    [{log.tag}]
                  </span>
                  <span className="text-slate-600 flex-1 break-words">{log.msg}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </main>

      {/* Floating Bottom Navigation Pill (Ref Style) */}
      <nav className="fixed bottom-3 inset-x-0 mx-auto w-fit z-30">
        <div className="glass-pill rounded-full p-1 flex items-center space-x-1 shadow-soft-xl">
          <button
            onClick={() => setActiveTab('monitor')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition ${
              activeTab === 'monitor'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/60 flex items-center space-x-1.5 transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configuration</span>
          </button>
        </div>
      </nav>

      {/* Settings Modal (Sleek Frosted Backdrop) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4">
          <div className="bg-white rounded-[32px] max-w-lg w-full p-6 shadow-soft-xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-800">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">System Configuration</h3>
                  <p className="text-[10px] text-slate-400">SMTP Alert & AI Parameters</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="mt-4 space-y-4">
              {/* SMTP Group */}
              <div className="bg-[#f8fafc] rounded-2xl p-3.5 border border-slate-100">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2.5 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-600" />
                  Email Dispatcher (SMTP)
                </h4>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="block text-slate-500 font-medium mb-1 text-[11px]">Server</label>
                    <input
                      type="text"
                      value={settingsForm.smtp_server}
                      onChange={(e) => setSettingsForm({ ...settingsForm, smtp_server: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-medium mb-1 text-[11px]">Port</label>
                    <input
                      type="number"
                      value={settingsForm.smtp_port}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, smtp_port: parseInt(e.target.value, 10) })
                      }
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-500 font-medium mb-1 text-[11px]">Sender Email</label>
                    <input
                      type="email"
                      value={settingsForm.smtp_username}
                      onChange={(e) => setSettingsForm({ ...settingsForm, smtp_username: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-500 font-medium mb-1 text-[11px]">App Password</label>
                    <input
                      type="password"
                      value={settingsForm.smtp_password}
                      onChange={(e) => setSettingsForm({ ...settingsForm, smtp_password: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-500 font-medium mb-1 text-[11px]">Recipient Email</label>
                    <input
                      type="email"
                      value={settingsForm.smtp_recipient}
                      onChange={(e) => setSettingsForm({ ...settingsForm, smtp_recipient: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div className="mt-2.5 flex justify-end">
                  <button
                    type="button"
                    onClick={handleTestEmail}
                    disabled={isTestingEmail}
                    className="inline-flex items-center px-3 py-1 rounded-full bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-800 border border-slate-200 shadow-sm transition"
                  >
                    {isTestingEmail ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                    Send Test Email
                  </button>
                </div>
              </div>

              {/* AI Vision Parameters */}
              <div className="bg-[#f8fafc] rounded-2xl p-3.5 border border-slate-100">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2.5 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-indigo-600" />
                  Detection & Debounce Tuning
                </h4>

                <div className="space-y-3 text-xs">
                  <div>
                    <div className="flex justify-between text-slate-600 font-semibold mb-1 text-[11px]">
                      <span>Confidence Threshold</span>
                      <span className="font-mono text-indigo-600">
                        {Math.round(settingsForm.confidence_threshold * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="95"
                      step="5"
                      value={Math.round(settingsForm.confidence_threshold * 100)}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          confidence_threshold: parseFloat(e.target.value) / 100.0,
                        })
                      }
                      className="w-full accent-slate-900 bg-slate-200 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-600 font-semibold mb-1 text-[11px]">
                      <span>Debounce Frames</span>
                      <span className="font-mono text-indigo-600">{settingsForm.debounce_frames} frames</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={settingsForm.debounce_frames}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          debounce_frames: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full accent-slate-900 bg-slate-200 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-600 font-semibold mb-1 text-[11px]">
                      <span>Cooldown Window</span>
                      <span className="font-mono text-indigo-600">
                        {settingsForm.email_cooldown_seconds}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="300"
                      step="5"
                      value={settingsForm.email_cooldown_seconds}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          email_cooldown_seconds: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full accent-slate-900 bg-slate-200 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-3.5 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-full bg-slate-900 hover:bg-black text-xs font-bold text-white shadow-soft transition"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Snapshot Lightbox Modal */}
      {lightboxData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4">
          <div className="relative max-w-3xl w-full bg-white rounded-[28px] overflow-hidden shadow-2xl flex flex-col border border-slate-100">
            <div className="p-3.5 bg-white flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <span className="text-xs font-mono font-bold text-slate-800">
                  {lightboxData.timestamp} • {Math.round((lightboxData.confidence || 0.85) * 100)}% Confidence
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href={lightboxData.url}
                  download="incident_snapshot.jpg"
                  className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => setLightboxData(null)}
                  className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-2 bg-black flex items-center justify-center">
              <img
                src={lightboxData.url}
                alt="Full Incident Snapshot"
                className="max-h-[70vh] w-auto object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
