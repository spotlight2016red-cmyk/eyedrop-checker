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
  const [cameraStatus, setCameraStatus] = useState({ width: 0, height: 0, readyState: 0, error: null, paused: true });
  const lastFrameRef = useRef(null);
  const intervalRef = useRef(null);
  const motionHistoryRef = useRef([]); // 動きの履歴（最近の動きを記録）

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

  // 監視開始時に即座にタイマーを開始（PWAでも動作するように）
  useEffect(() => {
    if (!isActive || !stream) return;
    
    // 監視開始時に即座にタイマーを開始
    if (!noMotionStartTime) {
      const now = Date.now();
      setNoMotionStartTime(now);
      setRemainingTime(NO_MOTION_THRESHOLD);
      console.log('[CameraMonitor] 監視開始: タイマーを開始', NO_MOTION_THRESHOLD);
      
      // タイマーを設定
      const timer = setTimeout(() => {
        console.log('[CameraMonitor] タイマー完了（動き検出なし）');
        if (onNoMotion) onNoMotion();
        setNoMotionTimer(null);
        setNoMotionStartTime(null);
        setRemainingTime(null);
      }, NO_MOTION_THRESHOLD);
      setNoMotionTimer(timer);
    }
  }, [isActive, stream, NO_MOTION_THRESHOLD, noMotionStartTime]);

  // バックグラウンドになったときにタイマーを開始
  useEffect(() => {
    if (!isActive) return;

    const handleVisibilityChange = () => {
      if (document.hidden && !noMotionStartTime) {
        // バックグラウンドになったとき、タイマーが開始されていない場合は開始
        const now = Date.now();
        setNoMotionStartTime(now);
        setRemainingTime(NO_MOTION_THRESHOLD);
        console.log('[CameraMonitor] バックグラウンドでタイマー開始');
        
        // タイマーを設定
        const timer = setTimeout(() => {
          console.log('[CameraMonitor] バックグラウンドでタイマー完了');
          if (onNoMotion) onNoMotion();
          setNoMotionTimer(null);
          setNoMotionStartTime(null);
          setRemainingTime(null);
        }, NO_MOTION_THRESHOLD);
        setNoMotionTimer(timer);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isActive, noMotionStartTime, NO_MOTION_THRESHOLD]);

  const startMonitoring = async () => {
    try {
      console.log('[CameraMonitor] カメラアクセス開始');
      
      // カメラアクセスの権限を確認
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('このブラウザはカメラアクセスをサポートしていません');
      }
      
      // カメラアクセスをリクエスト
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'user', // フロントカメラ
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      console.log('[CameraMonitor] カメラアクセス成功:', mediaStream);
      
      if (!videoRef.current) {
        console.error('[CameraMonitor] video要素が見つかりません');
        mediaStream.getTracks().forEach(track => track.stop());
        return;
      }
      
      // video要素にストリームを設定
      videoRef.current.srcObject = mediaStream;
      
      // video要素のイベントを監視
      videoRef.current.onloadedmetadata = () => {
        console.log('[CameraMonitor] メタデータ読み込み完了');
        console.log('[CameraMonitor] 動画サイズ:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
        console.log('[CameraMonitor] readyState:', videoRef.current?.readyState);
        setCameraStatus({
          width: videoRef.current?.videoWidth || 0,
          height: videoRef.current?.videoHeight || 0,
          readyState: videoRef.current?.readyState || 0,
          error: null,
          paused: videoRef.current?.paused ?? true
        });
        
        // メタデータ読み込み後、再生を開始
        if (videoRef.current && videoRef.current.paused) {
          console.log('[CameraMonitor] メタデータ読み込み後、再生を開始');
          videoRef.current.play().then(() => {
            console.log('[CameraMonitor] 再生成功');
            setCameraStatus(prev => ({ ...prev, paused: false }));
          }).catch(err => {
            console.error('[CameraMonitor] メタデータ読み込み後の再生エラー:', err);
          });
        }
      };
      
      videoRef.current.oncanplay = () => {
        console.log('[CameraMonitor] 動画再生可能');
        setCameraStatus(prev => ({
          ...prev,
          readyState: videoRef.current?.readyState || 0,
          paused: videoRef.current?.paused ?? true
        }));
        // 再生を再試行
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play().then(() => {
            console.log('[CameraMonitor] oncanplay後の再生成功');
            setCameraStatus(prev => ({ ...prev, paused: false }));
          }).catch(err => {
            console.error('[CameraMonitor] oncanplay後の再生エラー:', err);
          });
        }
      };
      
      videoRef.current.onplay = () => {
        console.log('[CameraMonitor] 動画再生開始');
        setCameraStatus(prev => ({
          ...prev,
          paused: false
        }));
      };
      
      videoRef.current.onpause = () => {
        console.log('[CameraMonitor] 動画再生停止');
        setCameraStatus(prev => ({
          ...prev,
          paused: true
        }));
      };
      
      videoRef.current.onerror = (e) => {
        console.error('[CameraMonitor] video要素エラー:', e);
        setCameraStatus(prev => ({
          ...prev,
          error: videoRef.current?.error?.message || 'エラーが発生しました'
        }));
      };
      
      // 定期的に状態を更新
      const statusInterval = setInterval(() => {
        if (videoRef.current) {
          // 動画サイズが取得できている場合は、メタデータが読み込まれていると判断
          const hasMetadata = videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0;
          const currentReadyState = videoRef.current.readyState;
          
          setCameraStatus({
            width: videoRef.current.videoWidth || 0,
            height: videoRef.current.videoHeight || 0,
            readyState: hasMetadata && currentReadyState === 0 ? 1 : currentReadyState, // メタデータが読み込まれている場合は1以上に設定
            error: videoRef.current.error ? videoRef.current.error.message : null,
            paused: videoRef.current.paused
          });
          
          // 再生状態を確認して、停止している場合は再開
          if (videoRef.current.paused && videoRef.current.readyState >= 2) {
            console.log('[CameraMonitor] 動画が停止しているため再開');
            videoRef.current.play().catch(err => {
              console.error('[CameraMonitor] 自動再生エラー:', err);
            });
          }
        }
      }, 1000);
      
      // クリーンアップ関数を保存（後で使用）
      videoRef.current._statusInterval = statusInterval;
      
      // ストリームを設定（先に設定）
      setStream(mediaStream);
      
      // 再生を開始（複数回試行）
      const tryPlay = async () => {
        if (!videoRef.current) return;
        
        try {
          await videoRef.current.play();
          console.log('[CameraMonitor] 動画再生開始成功');
          setCameraStatus(prev => ({ ...prev, paused: false }));
        } catch (playError) {
          console.error('[CameraMonitor] 動画再生エラー:', playError);
          // 再生に失敗した場合、少し待ってから再試行
          setTimeout(() => {
            if (videoRef.current && videoRef.current.paused) {
              console.log('[CameraMonitor] 再生再試行');
              tryPlay();
            }
          }, 1000);
        }
      };
      
      // すぐに再生を試行
      tryPlay();
      
      // 少し待ってから動き検出を開始（カメラが安定するまで）
      setTimeout(() => {
        startMotionDetection();
      }, 500);
      
    } catch (err) {
      console.error('[CameraMonitor] カメラアクセスエラー:', err);
      
      let errorMessage = 'カメラへのアクセスが許可されていません。';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'カメラへのアクセスが拒否されました。\n\nブラウザの設定からカメラへのアクセスを許可してください。\n\nSafari: 設定 > Safari > ウェブサイトの設定 > カメラ';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'カメラが見つかりませんでした。';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'カメラが他のアプリで使用中です。他のアプリを閉じてから再度お試しください。';
      } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
        errorMessage = 'カメラの設定が対応していません。';
      }
      
      alert(errorMessage);
      setIsActive(false); // エラー時は監視を停止
    }
  };

  const stopMonitoring = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (noMotionTimer) {
      clearTimeout(noMotionTimer);
      setNoMotionTimer(null);
    }
    if (videoRef.current && videoRef.current._statusInterval) {
      clearInterval(videoRef.current._statusInterval);
      videoRef.current._statusInterval = null;
    }
    setNoMotionStartTime(null);
    setRemainingTime(null);
    setCameraStatus({ width: 0, height: 0, readyState: 0, error: null, paused: true });
    motionHistoryRef.current = []; // 動きの履歴をクリア
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startMotionDetection = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');

    // setIntervalを使用してバックグラウンドでも動き検出を続ける
    const detectMotion = () => {
      // ページが非表示の場合は、動き検出はできないがタイマーは継続
      if (document.hidden) {
        console.log('[CameraMonitor] ページが非表示のため動き検出をスキップ（タイマーは継続）');
        return;
      }

      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const motionResult = detectFrameDifference(imageData);
      const hasMotion = motionResult.hasMotion;
      const intensity = motionResult.intensity;

      if (hasMotion) {
        // 動きの履歴を記録
        motionHistoryRef.current.push({
          time: Date.now(),
          intensity: intensity
        });
        
        // 連続した動きパターンを検出（目薬を取ってさす動作）
        const isEyedropPattern = checkMotionPattern();
        
        if (isEyedropPattern) {
          // 目薬をさす動作パターンを検出した場合、タイマーをリセット
          console.log('[CameraMonitor] 目薬をさす動作を検出、タイマーをリセット');
          setMotionCount(prev => prev + 1);
          if (onMotionDetected) onMotionDetected();
          
          // タイマーをリセット
          if (noMotionTimer) {
            clearTimeout(noMotionTimer);
            setNoMotionTimer(null);
          }
          setNoMotionStartTime(null);
          setRemainingTime(null);
          
          // 動きの履歴をクリア
          motionHistoryRef.current = [];
        } else {
          // 単発の動きだけではタイマーをリセットしない（冷蔵庫を開けるだけでは通知しない）
          // ただし、動き検出回数は増やす
          setMotionCount(prev => prev + 1);
        }
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
    };

    // 1秒ごとに動き検出を実行（バックグラウンドでもタイマーは継続）
    intervalRef.current = setInterval(detectMotion, 1000);
    
    // 初回実行
    detectMotion();
  };

  const detectFrameDifference = (currentImageData) => {
    if (!lastFrameRef.current) {
      lastFrameRef.current = currentImageData;
      return { hasMotion: false, intensity: 0 };
    }

    const currentData = currentImageData.data;
    const lastData = lastFrameRef.current.data;
    let diffPixels = 0;
    let totalDiff = 0;
    const threshold = 30; // 輝度差分の閾値

    for (let i = 0; i < currentData.length; i += 4) {
      const rDiff = Math.abs(currentData[i] - lastData[i]);
      const gDiff = Math.abs(currentData[i + 1] - lastData[i + 1]);
      const bDiff = Math.abs(currentData[i + 2] - lastData[i + 2]);
      const avgDiff = (rDiff + gDiff + bDiff) / 3;

      if (avgDiff > threshold) {
        diffPixels++;
        totalDiff += avgDiff;
      }
    }

    const diffRatio = diffPixels / (currentData.length / 4);
    const intensity = diffPixels > 0 ? totalDiff / diffPixels : 0; // 平均的な動きの強度
    lastFrameRef.current = currentImageData;
    
    return { 
      hasMotion: diffRatio > 0.05, // 5%以上の変化があれば動きあり
      intensity: intensity
    };
  };

  // 連続した動きパターンを検出（目薬を取ってさす動作）
  const checkMotionPattern = () => {
    const now = Date.now();
    const history = motionHistoryRef.current;
    
    // 30秒以内の動きを保持
    const recentHistory = history.filter(h => now - h.time < 30000);
    motionHistoryRef.current = recentHistory;
    
    if (recentHistory.length < 3) {
      return false; // 動きが少なすぎる
    }
    
    // 動きの強度を分析
    const intensities = recentHistory.map(h => h.intensity);
    const avgIntensity = intensities.reduce((a, b) => a + b, 0) / intensities.length;
    
    // 大きな動き（冷蔵庫を開ける）と小さな動き（目薬をさす）の両方が検出された場合
    // これは目薬を取ってさす動作パターンと判断
    const hasLargeMotion = intensities.some(i => i > 50); // 大きな動き
    const hasSmallMotion = intensities.some(i => i > 0 && i < 50); // 小さな動き
    
    if (hasLargeMotion && hasSmallMotion && recentHistory.length >= 3) {
      console.log('[CameraMonitor] 目薬をさす動作パターンを検出');
      return true;
    }
    
    return false;
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
            onClick={() => {
              // 動画要素をクリックしたときに再生を開始
              if (videoRef.current && videoRef.current.paused) {
                videoRef.current.play().catch(err => {
                  console.error('[CameraMonitor] クリック時の再生エラー:', err);
                });
              }
            }}
            style={{ cursor: 'pointer' }}
          />
          {cameraStatus.width === 0 && cameraStatus.height === 0 && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#fff',
              fontSize: '14px',
              textAlign: 'center',
              pointerEvents: 'none'
            }}>
              カメラを読み込み中...
            </div>
          )}
          {cameraStatus.width > 0 && cameraStatus.height > 0 && cameraStatus.paused && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#fff',
              fontSize: '14px',
              textAlign: 'center',
              pointerEvents: 'none',
              background: 'rgba(0, 0, 0, 0.5)',
              padding: '8px 16px',
              borderRadius: '8px'
            }}>
              タップして再生
            </div>
          )}
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
            {/* デバッグ情報 */}
            {isActive && (
              <div style={{ 
                fontSize: '12px', 
                color: '#64748b',
                marginTop: '8px',
                padding: '8px',
                background: '#f3f4f6',
                borderRadius: '4px'
              }}>
                <div>タイマー状態: {noMotionStartTime ? '開始済み' : '未開始'}</div>
                {noMotionStartTime && (
                  <div>開始時刻: {new Date(noMotionStartTime).toLocaleTimeString()}</div>
                )}
                {remainingTime !== null && (
                  <div>残り時間: {formatTime(remainingTime)}</div>
                )}
                {/* カメラ状態 */}
                <div style={{ marginTop: '8px', borderTop: '1px solid #d1d5db', paddingTop: '8px' }}>
                  <div>カメラ状態: {stream || (videoRef.current && videoRef.current.srcObject) ? '接続済み' : '未接続'}</div>
                  <div>動画サイズ: {cameraStatus.width} x {cameraStatus.height}</div>
                  <div>再生状態: {cameraStatus.readyState === 4 ? '準備完了' : `準備中(${cameraStatus.readyState})`}</div>
                  <div>再生中: {cameraStatus.paused ? '停止中' : '再生中'}</div>
                  {cameraStatus.error && (
                    <div style={{ color: '#ef4444' }}>エラー: {cameraStatus.error}</div>
                  )}
                  {videoRef.current && !videoRef.current.srcObject && (
                    <div style={{ color: '#ef4444' }}>⚠️ ストリームが設定されていません</div>
                  )}
                </div>
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
          <p style={{ marginTop: '12px', fontSize: '12px', color: '#64748b' }}>
            ※ 目薬を取ってさす動作（連続した動きパターン）を検出した場合、タイマーをリセットします。<br/>
            ※ 冷蔵庫を開けるだけの単発の動きでは通知しません。
          </p>
        </div>
      )}
    </div>
  );
}

