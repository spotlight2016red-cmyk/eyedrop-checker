import { useEffect, useRef, useState } from 'react';
import './CameraMonitor.css';

export function CameraMonitor({ onMotionDetected, onNoMotion }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [stream, setStream] = useState(null);
  const [motionCount, setMotionCount] = useState(0);
  const [noMotionTimer, setNoMotionTimer] = useState(null);
  const lastFrameRef = useRef(null);
  const animationFrameRef = useRef(null);

  const NO_MOTION_THRESHOLD = 5 * 60 * 1000; // 5分（ミリ秒）

  useEffect(() => {
    if (isActive && videoRef.current) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
    return () => {
      stopMonitoring();
    };
  }, [isActive]);

  const startMonitoring = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }, // フロントカメラ
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play();
        setStream(mediaStream);
        startMotionDetection();
      }
    } catch (err) {
      console.error('カメラアクセスエラー:', err);
      alert('カメラへのアクセスが許可されていません。設定を確認してください。');
    }
  };

  const stopMonitoring = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (noMotionTimer) {
      clearTimeout(noMotionTimer);
      setNoMotionTimer(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startMotionDetection = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    let lastTime = Date.now();

    const detectMotion = () => {
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationFrameRef.current = requestAnimationFrame(detectMotion);
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastTime < 1000) { // 1秒ごとにチェック
        animationFrameRef.current = requestAnimationFrame(detectMotion);
        return;
      }
      lastTime = currentTime;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hasMotion = detectFrameDifference(imageData);

      if (hasMotion) {
        setMotionCount(prev => prev + 1);
        if (onMotionDetected) onMotionDetected();
        // 動きがあったらタイマーをリセット
        if (noMotionTimer) {
          clearTimeout(noMotionTimer);
        }
        const timer = setTimeout(() => {
          if (onNoMotion) onNoMotion();
        }, NO_MOTION_THRESHOLD);
        setNoMotionTimer(timer);
      }

      animationFrameRef.current = requestAnimationFrame(detectMotion);
    };

    detectMotion();
  };

  const detectFrameDifference = (currentImageData) => {
    if (!lastFrameRef.current) {
      lastFrameRef.current = currentImageData;
      return false;
    }

    const currentData = currentImageData.data;
    const lastData = lastFrameRef.current.data;
    let diffPixels = 0;
    const threshold = 30; // 輝度差分の閾値

    for (let i = 0; i < currentData.length; i += 4) {
      const rDiff = Math.abs(currentData[i] - lastData[i]);
      const gDiff = Math.abs(currentData[i + 1] - lastData[i + 1]);
      const bDiff = Math.abs(currentData[i + 2] - lastData[i + 2]);
      const avgDiff = (rDiff + gDiff + bDiff) / 3;

      if (avgDiff > threshold) {
        diffPixels++;
      }
    }

    const diffRatio = diffPixels / (currentData.length / 4);
    lastFrameRef.current = currentImageData;
    
    return diffRatio > 0.05; // 5%以上の変化があれば動きあり
  };

  return (
    <div className="camera-monitor">
      <div className="camera-header">
        <h2>カメラ監視モード</h2>
        <button
          className={`camera-toggle ${isActive ? 'active' : ''}`}
          onClick={() => setIsActive(!isActive)}
        >
          {isActive ? '監視を停止' : '監視を開始'}
        </button>
      </div>

      {isActive && (
        <div className="camera-view">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-video"
          />
          <canvas ref={canvasRef} className="camera-canvas" style={{ display: 'none' }} />
          <div className="camera-status">
            <div>動き検出回数: {motionCount}</div>
            <div className="status-indicator">
              <span className={`status-dot ${isActive ? 'active' : ''}`}></span>
              {isActive ? '監視中' : '停止中'}
            </div>
          </div>
        </div>
      )}

      {!isActive && (
        <div className="camera-placeholder">
          <p>カメラ監視を開始すると、動きを検出します。</p>
          <p>5分間動きが検出されない場合、通知が送られます。</p>
        </div>
      )}
    </div>
  );
}

