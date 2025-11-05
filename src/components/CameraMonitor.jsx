import { useEffect, useRef, useState } from 'react';
import './CameraMonitor.css';

export function CameraMonitor({ onMotionDetected, onNoMotion }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [stream, setStream] = useState(null);
  const [motionCount, setMotionCount] = useState(0);
  const [noMotionTimer, setNoMotionTimer] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const [noMotionStartTime, setNoMotionStartTime] = useState(null);
  const [remainingTime, setRemainingTime] = useState(null);
  const lastFrameRef = useRef(null);
  const animationFrameRef = useRef(null);

  const NO_MOTION_THRESHOLD = testMode ? 30 * 1000 : 5 * 60 * 1000; // テストモード: 30秒、通常: 5分（ミリ秒）
  
  // 残り時間を計算する（1秒ごとに更新）
  useEffect(() => {
    if (!isActive || !noMotionStartTime) {
      setRemainingTime(null);
      return;
    }
    
    // 即座に計算して表示
    const updateRemainingTime = () => {
      if (noMotionStartTime) {
        const elapsed = Date.now() - noMotionStartTime;
        const remaining = Math.max(0, NO_MOTION_THRESHOLD - elapsed);
        setRemainingTime(remaining);
      }
    };
    
    // 初回計算
    updateRemainingTime();
    
    // 1秒ごとに更新
    const interval = setInterval(updateRemainingTime, 1000);
    
    return () => clearInterval(interval);
  }, [isActive, noMotionStartTime, NO_MOTION_THRESHOLD]);

  useEffect(() => {
    if (isActive && videoRef.current) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
    return () => {
      stopMonitoring();
    };
  }, [isActive, testMode]);

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
    setNoMotionStartTime(null);
    setRemainingTime(null);
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
          setNoMotionTimer(null);
        }
        setNoMotionStartTime(null);
        setRemainingTime(null);
      } else {
        // 動きが検出されない場合、タイマーを開始
        const now = Date.now();
        
        // 最初のフレームは除外（lastFrameRefがnullの場合）
        if (!lastFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(detectMotion);
          return;
        }
        
        // 動きがない状態が始まった時刻を記録
        if (!noMotionStartTime) {
          setNoMotionStartTime(now);
          // 即座に残り時間を設定
          setRemainingTime(NO_MOTION_THRESHOLD);
          console.log('[CameraMonitor] 動きなしタイマー開始, 残り時間:', NO_MOTION_THRESHOLD);
        }
        
        // タイマーが設定されていない場合、設定する
        if (!noMotionTimer && noMotionStartTime) {
          const elapsed = now - noMotionStartTime;
          const remaining = NO_MOTION_THRESHOLD - elapsed;
          
          if (remaining > 0) {
            const timer = setTimeout(() => {
              console.log('[CameraMonitor] 動きなしタイマー完了');
              if (onNoMotion) onNoMotion();
              setNoMotionTimer(null);
              setNoMotionStartTime(null);
              setRemainingTime(null);
            }, remaining);
            setNoMotionTimer(timer);
          } else {
            // 既に閾値を超えている場合
            console.log('[CameraMonitor] 既に閾値を超えています');
            if (onNoMotion) onNoMotion();
            setNoMotionStartTime(null);
            setRemainingTime(null);
          }
        }
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

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
      return `${minutes}分${remainingSeconds}秒`;
    }
    return `${remainingSeconds}秒`;
  };

  return (
    <div className="camera-monitor">
      <div className="camera-header">
        <h2>カメラ監視モード</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {!isActive && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: '#1f2937' }}>
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                disabled={isActive}
              />
              <span>テストモード（30秒）</span>
            </label>
          )}
          <button
            className={`camera-toggle ${isActive ? 'active' : ''}`}
            onClick={() => setIsActive(!isActive)}
          >
            {isActive ? '監視を停止' : '監視を開始'}
          </button>
        </div>
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
            {remainingTime !== null && remainingTime > 0 && (
              <div style={{ 
                color: remainingTime < 10000 ? '#ef4444' : '#64748b',
                fontWeight: remainingTime < 10000 ? 'bold' : 'normal',
                fontSize: '14px'
              }}>
                動きなし: 残り {formatTime(remainingTime)}
              </div>
            )}
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
          <p>{testMode ? '30秒' : '5分'}間動きが検出されない場合、通知が送られます。</p>
        </div>
      )}
    </div>
  );
}

