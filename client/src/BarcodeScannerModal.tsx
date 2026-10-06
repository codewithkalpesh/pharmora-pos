import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { triggerHaptic } from './platform.js';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
  title?: string;
}

export function BarcodeScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
  title = 'Scan Product Barcode',
}: BarcodeScannerModalProps) {
  const [manualCode, setManualCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'pharmora-barcode-reader';

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      return;
    }

    let isMounted = true;
    setErrorMsg('');
    setIsPermissionDenied(false);

    // Initialize camera list and start scanning
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (!isMounted) return;
        if (devices && devices.length > 0) {
          setCameras(devices);
          // Prefer back/environment camera
          const backCam = devices.find(
            (d) =>
              d.label.toLowerCase().includes('back') ||
              d.label.toLowerCase().includes('rear') ||
              d.label.toLowerCase().includes('environment'),
          );
          const camId = backCam ? backCam.id : devices[0].id;
          setSelectedCameraId(camId);
          startScanner(camId);
        } else {
          setErrorMsg('No cameras found on this device. You can enter the barcode manually.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Camera detection error:', err);
        setIsPermissionDenied(true);
        setErrorMsg('Camera access was denied or is not supported. Please allow camera permissions or enter the barcode manually.');
      });

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [isOpen]);

  async function startScanner(cameraId: string) {
    try {
      if (scannerRef.current) {
        await stopScanner();
      }

      const html5QrCode = new Html5Qrcode(readerElementId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      });

      scannerRef.current = html5QrCode;

      const config = {
        fps: 15,
        qrbox: { width: 280, height: 160 },
        aspectRatio: 1.0,
      };

      await html5QrCode.start(
        cameraId,
        config,
        (decodedText) => {
          handleSuccess(decodedText);
        },
        () => {
          // Ignore ongoing frame search failures
        },
      );

      setIsScanning(true);
    } catch (err: any) {
      console.warn('Failed to start barcode scanner:', err);
      setIsScanning(false);
      setErrorMsg(
        err?.message || 'Could not start camera. Please verify camera permissions.',
      );
    }
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        console.warn('Scanner stop error:', e);
      } finally {
        scannerRef.current = null;
        setIsScanning(false);
      }
    }
  }

  function handleSuccess(code: string) {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    // Play subtle audio beep if possible
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // AudioContext unavailable
    }

    triggerHaptic('success');
    stopScanner();
    onScanSuccess(cleanCode);
    onClose();
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleSuccess(manualCode);
  }

  async function handleSwitchCamera(e: React.ChangeEvent<HTMLSelectElement>) {
    const newId = e.target.value;
    setSelectedCameraId(newId);
    if (newId) {
      await startScanner(newId);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="scanner-modal-backdrop" role="dialog" aria-modal="true">
      <div className="scanner-modal-card">
        {/* Header */}
        <div className="scanner-header">
          <div className="scanner-title-area">
            <span className="scanner-icon">📷</span>
            <h3>{title}</h3>
          </div>
          <button
            type="button"
            className="scanner-close-btn"
            onClick={() => {
              stopScanner();
              onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="scanner-viewport-wrapper">
          <div id={readerElementId} className="scanner-video-feed" />
          
          {/* Scanning Reticle & Overlay */}
          {isScanning && (
            <div className="scanner-reticle-overlay pointer-events-none">
              <div className="scanner-laser" />
              <div className="scanner-corner top-left" />
              <div className="scanner-corner top-right" />
              <div className="scanner-corner bottom-left" />
              <div className="scanner-corner bottom-right" />
              <span className="scanner-hint">Align barcode inside frame</span>
            </div>
          )}

          {/* Camera Selection */}
          {cameras.length > 1 && (
            <div className="scanner-camera-select-row">
              <label htmlFor="cameraSelect">Camera:</label>
              <select
                id="cameraSelect"
                value={selectedCameraId}
                onChange={handleSwitchCamera}
                className="scanner-camera-dropdown"
              >
                {cameras.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {c.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Permission / Error Notice */}
          {errorMsg && (
            <div className="scanner-alert-banner">
              <span className="scanner-alert-icon">⚠️</span>
              <div className="scanner-alert-text">{errorMsg}</div>
              {isPermissionDenied && (
                <button
                  type="button"
                  className="scanner-retry-btn"
                  onClick={() => {
                    setErrorMsg('');
                    setIsPermissionDenied(false);
                    if (selectedCameraId) startScanner(selectedCameraId);
                  }}
                >
                  Retry Camera
                </button>
              )}
            </div>
          )}
        </div>

        {/* Manual Fallback Form */}
        <div className="scanner-manual-footer">
          <div className="scanner-manual-divider">
            <span>OR ENTER MANUALLY</span>
          </div>
          <form onSubmit={handleManualSubmit} className="scanner-manual-form">
            <input
              type="text"
              className="scanner-manual-input"
              placeholder="Type barcode or SKU number..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="scanner-manual-submit-btn"
              disabled={!manualCode.trim()}
            >
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
