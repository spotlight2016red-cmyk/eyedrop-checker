import { useState, useRef, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, query, where, getDocs, orderBy } from 'firebase/firestore';
import { storage, db } from '../config/firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import './PhotoCapture.css';

export function PhotoCapture() {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // 自撮りモード用の状態
  const [isSelfieMode, setIsSelfieMode] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [capturedPhotos, setCapturedPhotos] = useState([]); // 連続撮影した写真
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null); // 選択した写真のインデックス
  const playbackIntervalRef = useRef(null);

  // カメラを開始
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // 背面カメラを優先
      });
      setStream(mediaStream);
      
      // video要素がレンダリングされるまで待つ（最大1秒）
      let retries = 0;
      const maxRetries = 10;
      while (!videoRef.current && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      if (!videoRef.current) {
        console.error('[PhotoCapture] video要素が見つかりません（タイムアウト）');
        mediaStream.getTracks().forEach(track => track.stop());
        setStream(null);
        alert('カメラの初期化に失敗しました。ページをリロードして再度お試しください。');
        return;
      }
      
      console.log('[PhotoCapture] video要素を確認:', !!videoRef.current);
      
      // 再生を試みる関数（統一）
      const attemptPlay = async () => {
        if (!videoRef.current) return false;
        
        try {
          await videoRef.current.play();
          console.log('[PhotoCapture] 動画再生開始成功');
          return true;
        } catch (playError) {
          console.error('[PhotoCapture] 動画再生エラー:', playError);
          return false;
        }
      };
      
      videoRef.current.srcObject = mediaStream;
      
      // video要素のイベントを監視
      videoRef.current.onloadedmetadata = () => {
        console.log('[PhotoCapture] メタデータ読み込み完了');
        // メタデータ読み込み後、再生を開始
        if (videoRef.current && videoRef.current.paused) {
          console.log('[PhotoCapture] メタデータ読み込み後、再生を開始');
          attemptPlay();
        }
      };
      
      videoRef.current.oncanplay = () => {
        console.log('[PhotoCapture] 動画再生可能');
        // 再生を再試行（まだ停止している場合）
        if (videoRef.current && videoRef.current.paused) {
          console.log('[PhotoCapture] oncanplay後の再生を試行');
          attemptPlay();
        }
      };
      
      videoRef.current.onplay = () => {
        console.log('[PhotoCapture] 動画再生開始');
      };
      
      videoRef.current.onerror = (e) => {
        console.error('[PhotoCapture] video要素エラー:', e);
        alert(`動画の再生に失敗しました: ${videoRef.current?.error?.message || 'エラーが発生しました'}`);
      };
      
    } catch (err) {
      console.error('[PhotoCapture] カメラアクセスエラー:', err);
      alert('カメラへのアクセスが許可されていません。ブラウザの設定からカメラへのアクセスを許可してください。');
    }
  };

  // カメラを停止
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPhotoUrl(null);
  };

  // 写真を撮影（1枚）
  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // 一時的に画像を表示
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPhotoUrl(dataUrl);
  };

  // 自撮りモード：カウントダウン開始
  const startSelfieCapture = () => {
    if (!stream) {
      alert('まずカメラを開始してください');
      return;
    }
    setIsCapturing(true);
    setCapturedPhotos([]);
    setCurrentPhotoIndex(0);
    setSelectedPhotoIndex(null); // 選択をリセット
    
    // カウントダウン（3, 2, 1）
    let count = 3;
    setCountdown(count);
    
    const countdownInterval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(countdownInterval);
        setCountdown(null);
        // カウントダウン終了後、連続撮影開始
        startContinuousCapture();
      }
    }, 1000);
  };

  // 連続撮影（3秒間で10枚）
  const startContinuousCapture = () => {
    const photos = [];
    const captureCount = 10; // 3秒間で10枚
    const interval = 300; // 300msごと
    
    let captured = 0;
    const captureInterval = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        clearInterval(captureInterval);
        setIsCapturing(false);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      photos.push(dataUrl);
      captured++;

      if (captured >= captureCount) {
        clearInterval(captureInterval);
        setIsCapturing(false);
        setCapturedPhotos(photos);
        // 自動的に再生開始
        playPhotos();
      }
    }, interval);
  };

  // 撮影した写真を再生（スライドショー）
  const playPhotos = () => {
    if (capturedPhotos.length === 0) return;
    
    setIsPlaying(true);
    setCurrentPhotoIndex(0);
    
    let index = 0;
    playbackIntervalRef.current = setInterval(() => {
      index++;
      if (index >= capturedPhotos.length) {
        // 最後まで再生したら停止
        stopPlayback();
      } else {
        setCurrentPhotoIndex(index);
      }
    }, 200); // 200msごとに次の写真に切り替え（約2秒で全10枚）
  };

  // 再生停止
  const stopPlayback = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    setIsPlaying(false);
  };

  // 再生リセット
  const resetPlayback = () => {
    stopPlayback();
    setCurrentPhotoIndex(0);
  };
  
  // 前の写真に移動
  const goToPreviousPhoto = () => {
    stopPlayback(); // 再生中なら停止
    if (currentPhotoIndex > 0) {
      setCurrentPhotoIndex(currentPhotoIndex - 1);
    } else {
      setCurrentPhotoIndex(capturedPhotos.length - 1); // 最初なら最後に
    }
  };
  
  // 次の写真に移動
  const goToNextPhoto = () => {
    stopPlayback(); // 再生中なら停止
    if (currentPhotoIndex < capturedPhotos.length - 1) {
      setCurrentPhotoIndex(currentPhotoIndex + 1);
    } else {
      setCurrentPhotoIndex(0); // 最後なら最初に
    }
  };

  // OKボタン：アップロード
  const confirmAndUpload = async () => {
    if (capturedPhotos.length === 0) return;
    
    setUploading(true);
    try {
      // すべての写真をアップロード
      const timestamp = Date.now();
      const uploadPromises = capturedPhotos.map(async (photoDataUrl, index) => {
        // DataURLをBlobに変換
        const response = await fetch(photoDataUrl);
        const blob = await response.blob();
        
        // Firebase Storageにアップロード
        const fileName = `eyedrop-action/${user.uid}/${timestamp}-${index}.jpg`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, blob);
        return await getDownloadURL(storageRef);
      });

      const photoUrls = await Promise.all(uploadPromises);

      // Firestoreに保存（すべての写真URLを含む）
      await addDoc(collection(db, 'eyedropPhotos'), {
        userId: user.uid,
        email: user.email,
        photoUrls: photoUrls, // 複数の写真URL
        photoCount: photoUrls.length,
        selectedPhotoIndex: selectedPhotoIndex !== null ? selectedPhotoIndex : 0, // 選択した写真のインデックス（未選択の場合は0）
        timestamp: new Date(),
        type: 'correct-action', // 正しい動作の写真
        mode: 'selfie' // 自撮りモード
      });

      alert('写真をアップロードしました！\n正しい動作として保存されました。');
      setCapturedPhotos([]);
      setCurrentPhotoIndex(0);
      loadUploadedPhotos();
    } catch (err) {
      console.error('[PhotoCapture] アップロードエラー:', err);
      console.error('[PhotoCapture] エラー詳細:', err.code, err.message);
      
      let errorMessage = `アップロードに失敗しました: ${err.message || err.code || '不明なエラー'}`;
      
      // CORSエラーの場合、より詳細なメッセージを表示
      if (err.code === 'storage/unauthorized' || err.message?.includes('CORS') || err.message?.includes('permission')) {
        errorMessage = 'アップロードに失敗しました。\n\nFirebase Storageのセキュリティルールが設定されていない可能性があります。\n\nFirebase ConsoleでStorageのセキュリティルールを設定してください。';
      }
      
      alert(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  // NGボタン：再撮影
  const rejectAndRetry = () => {
    setCapturedPhotos([]);
    setCurrentPhotoIndex(0);
    setSelectedPhotoIndex(null);
    stopPlayback();
  };
  
  // この写真を選択
  const selectCurrentPhoto = () => {
    setSelectedPhotoIndex(currentPhotoIndex);
    alert(`写真 ${currentPhotoIndex + 1} を選択しました。\nアップロード時にこの写真がメイン表示として使用されます。`);
  };

  // 写真をアップロード
  const uploadPhoto = async () => {
    if (!user || !photoUrl) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setUploading(true);
    try {
      // CanvasからBlobを取得
      canvas.toBlob(async (blob) => {
        if (!blob) {
          setUploading(false);
          return;
        }

        try {
          // Firebase Storageにアップロード
          const timestamp = Date.now();
          const fileName = `eyedrop-action/${user.uid}/${timestamp}.jpg`;
          const storageRef = ref(storage, fileName);
          await uploadBytes(storageRef, blob);
          const downloadURL = await getDownloadURL(storageRef);

          // Firestoreに保存
          await addDoc(collection(db, 'eyedropPhotos'), {
            userId: user.uid,
            email: user.email,
            photoUrl: downloadURL,
            timestamp: new Date(),
            type: 'correct-action' // 正しい動作の写真
          });

          alert('写真をアップロードしました！\n正しい動作として保存されました。');
          setPhotoUrl(null);
          loadUploadedPhotos();
        } catch (err) {
          console.error('[PhotoCapture] アップロードエラー:', err);
          console.error('[PhotoCapture] エラー詳細:', err.code, err.message);
          
          let errorMessage = `アップロードに失敗しました: ${err.message || err.code || '不明なエラー'}`;
          
          // CORSエラーの場合、より詳細なメッセージを表示
          if (err.code === 'storage/unauthorized' || err.message?.includes('CORS') || err.message?.includes('permission')) {
            errorMessage = 'アップロードに失敗しました。\n\nFirebase Storageのセキュリティルールが設定されていない可能性があります。\n\nFirebase ConsoleでStorageのセキュリティルールを設定してください。';
          }
          
          alert(errorMessage);
        } finally {
          setUploading(false);
        }
      }, 'image/jpeg', 0.8);
    } catch (err) {
      console.error('写真処理エラー:', err);
      alert(`写真の処理に失敗しました: ${err.message}`);
      setUploading(false);
    }
  };

  // アップロード済み写真を読み込み
  const loadUploadedPhotos = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'eyedropPhotos'),
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(q);
      const photos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUploadedPhotos(photos);
    } catch (err) {
      // 権限エラーの場合は警告を表示（初回のみ）
      const isPermissionError = err.code === 'permission-denied' || 
                                 err.code === 'permissions-error' ||
                                 err.message?.includes('permissions') ||
                                 err.message?.includes('Missing or insufficient permissions');
      
      if (isPermissionError) {
        console.warn('[PhotoCapture] Firestoreの読み取り権限がありません。Firestoreのセキュリティルールを確認してください。', err);
        // エラーを静かに処理（ユーザーに通知しない）
        setUploadedPhotos([]);
      } else {
        console.error('[PhotoCapture] 写真読み込みエラー:', err);
        // その他のエラーも静かに処理
        setUploadedPhotos([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // コンポーネントマウント時にアップロード済み写真を読み込み
  useEffect(() => {
    if (user) {
      loadUploadedPhotos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      stopCamera();
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, []);

  if (!user) return null;

  return (
    <div className="photo-capture">
      <h3 className="photo-title">正しい動作の写真を送る</h3>
      <p className="photo-desc">
        目薬をさす正しい動作を写真で送ってください。<br />
        将来的にAIがこの動作を学習して、正確に検知できるようになります。
      </p>

      {/* モード選択 */}
      {!stream && (
        <div className="photo-mode-selector">
          <button
            onClick={() => {
              setIsSelfieMode(true);
              startCamera();
            }}
            className="photo-btn photo-btn-selfie"
          >
            📷 自撮りモード（カウントダウン撮影）
          </button>
          <button
            onClick={() => {
              setIsSelfieMode(false);
              startCamera();
            }}
            className="photo-btn"
          >
            📸 通常モード（1枚撮影）
          </button>
        </div>
      )}

      {stream && (
        <div className="photo-camera-view">
          <div className="photo-video-container">
            {/* カウントダウン表示 */}
            {countdown !== null && (
              <div className="photo-countdown">
                <div className="photo-countdown-number">{countdown}</div>
              </div>
            )}
            
            {/* 撮影中表示 */}
            {isCapturing && countdown === null && (
              <div className="photo-capturing">
                <div className="photo-capturing-text">撮影中...</div>
              </div>
            )}

            {/* 再生画面 */}
            {capturedPhotos.length > 0 && !isCapturing && (
              <div className="photo-playback">
                {/* 前/次ボタン（画像の左右） */}
                <button
                  onClick={goToPreviousPhoto}
                  className="photo-btn-nav photo-btn-nav-prev"
                  aria-label="前の写真"
                >
                  ◀
                </button>
                <button
                  onClick={goToNextPhoto}
                  className="photo-btn-nav photo-btn-nav-next"
                  aria-label="次の写真"
                >
                  ▶
                </button>
                
                <img 
                  src={capturedPhotos[currentPhotoIndex]} 
                  alt={`撮影した写真 ${currentPhotoIndex + 1}/${capturedPhotos.length}`}
                  className="photo-playback-image"
                />
                <div className="photo-playback-info">
                  {currentPhotoIndex + 1} / {capturedPhotos.length}
                </div>
                <div className="photo-playback-controls">
                  {!isPlaying ? (
                    <>
                      <button onClick={playPhotos} className="photo-btn-play">
                        ▶️ 再生
                      </button>
                      <button onClick={resetPlayback} className="photo-btn-reset">
                        🔄 最初から
                      </button>
                    </>
                  ) : (
                    <button onClick={stopPlayback} className="photo-btn-stop-playback">
                      ⏸️ 停止
                    </button>
                  )}
                </div>
                <div className="photo-confirm-actions">
                  <button
                    onClick={selectCurrentPhoto}
                    className="photo-btn-select"
                    disabled={uploading}
                    style={{
                      background: selectedPhotoIndex === currentPhotoIndex 
                        ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                        : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      opacity: uploading ? 0.5 : 1
                    }}
                  >
                    {selectedPhotoIndex === currentPhotoIndex ? '✓ 選択済み' : '📌 この写真を選択'}
                  </button>
                  <button
                    onClick={rejectAndRetry}
                    className="photo-btn-reject"
                    disabled={uploading}
                  >
                    ❌ やり直す
                  </button>
                  <button
                    onClick={confirmAndUpload}
                    className="photo-btn-confirm"
                    disabled={uploading}
                  >
                    {uploading ? 'アップロード中...' : '✅ OK'}
                  </button>
                </div>
              </div>
            )}

            {/* 通常モード：1枚撮影のプレビュー */}
            {isSelfieMode === false && photoUrl && capturedPhotos.length === 0 && (
              <div className="photo-preview">
                <img src={photoUrl} alt="撮影した写真" />
                <div className="photo-preview-actions">
                  <button
                    onClick={() => setPhotoUrl(null)}
                    className="photo-btn-cancel"
                  >
                    やり直す
                  </button>
                  <button
                    onClick={uploadPhoto}
                    disabled={uploading}
                    className="photo-btn-upload"
                  >
                    {uploading ? 'アップロード中...' : '✓ アップロード'}
                  </button>
                </div>
              </div>
            )}

            {/* ビデオ表示（常に表示、オーバーレイでカウントダウンや撮影中を表示） */}
            {capturedPhotos.length === 0 && !photoUrl && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="photo-video"
                onClick={async () => {
                  // 動画要素をクリックしたときに再生を開始（PWAモードで自動再生が制限される場合に対応）
                  if (videoRef.current && videoRef.current.paused) {
                    try {
                      await videoRef.current.play();
                      console.log('[PhotoCapture] クリック時の再生成功');
                    } catch (err) {
                      console.error('[PhotoCapture] クリック時の再生エラー:', err);
                    }
                  }
                }}
                style={{ cursor: 'pointer' }}
              />
            )}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
          
          <div className="photo-controls">
            {/* 自撮りモード：カウントダウン撮影ボタン */}
            {isSelfieMode && capturedPhotos.length === 0 && countdown === null && !isCapturing && (
              <button onClick={startSelfieCapture} className="photo-btn-capture-selfie" disabled={isCapturing}>
                📸 カウントダウン撮影
              </button>
            )}
            
            {/* 通常モード：1枚撮影ボタン */}
            {isSelfieMode === false && !photoUrl && (
              <button onClick={capturePhoto} className="photo-btn-capture">
                📸 写真を撮る
              </button>
            )}
            
            <button onClick={stopCamera} className="photo-btn-stop">
              カメラを停止
            </button>
          </div>
        </div>
      )}

      {/* アップロード済み写真一覧 */}
      {uploadedPhotos.length > 0 && (
        <div className="photo-list">
          <h4 className="photo-list-title">アップロード済み写真</h4>
          {loading ? (
            <p>読み込み中...</p>
          ) : (
            <div className="photo-grid">
              {uploadedPhotos.map((photo) => {
                // 自撮りモード（複数写真）と通常モード（1枚）の両方に対応
                // 選択した写真がある場合はそれを表示、なければ最初の写真を表示
                const selectedIndex = photo.selectedPhotoIndex !== undefined ? photo.selectedPhotoIndex : 0;
                const imageUrl = photo.photoUrls && photo.photoUrls.length > 0 
                  ? photo.photoUrls[selectedIndex] // 自撮りモード：選択した写真（または最初の写真）を表示
                  : photo.photoUrl; // 通常モード：1枚の写真
                
                console.log('[PhotoCapture] 写真データ:', {
                  id: photo.id,
                  photoUrl: photo.photoUrl,
                  photoUrls: photo.photoUrls,
                  imageUrl: imageUrl,
                  mode: photo.mode
                });
                
                return (
                  <div key={photo.id} className="photo-item">
                    {imageUrl ? (
                      <img 
                        src={imageUrl} 
                        alt="アップロード済み写真" 
                        onError={(e) => {
                          console.error('[PhotoCapture] 画像読み込みエラー:', {
                            imageUrl,
                            photoId: photo.id,
                            photoData: photo
                          });
                          e.target.style.display = 'none';
                        }}
                        onLoad={() => {
                          console.log('[PhotoCapture] 画像読み込み成功:', imageUrl);
                        }}
                      />
                    ) : (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                        画像がありません
                      </div>
                    )}
                    <p className="photo-date">
                      {photo.timestamp?.toDate?.().toLocaleString('ja-JP') || 
                       (photo.timestamp instanceof Date ? photo.timestamp.toLocaleString('ja-JP') : '日時不明')}
                    </p>
                    {photo.photoUrls && photo.photoUrls.length > 1 && (
                      <p className="photo-count" style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        {photo.photoUrls.length}枚
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

