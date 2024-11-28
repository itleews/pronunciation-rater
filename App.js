import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Animated, PanResponder } from 'react-native';
import { Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import Svg, { Circle, G } from 'react-native-svg';
require('dotenv').config();

const App = () => {
  const [recording, setRecording] = useState();
  const [recordingURI, setRecordingURI] = useState(null);
  const [sound, setSound] = useState(null);
  const [recognizedText, setRecognizedText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [pronunciationScore, setPronunciationScore] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [soundPosition, setSoundPosition] = useState(0);
  const [soundDuration, setSoundDuration] = useState(0);
  const [abortController, setAbortController] = useState(null); // AbortController 상태 추가
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(100)).current;
  const [showResult, setShowResult] = useState(false);

  const accessKey = process.env.ACCESS_KEY;
  const languageCode = process.env.LANGUAGE_CODE;

  useEffect(() => {
    const initializeAudioSession = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          playThroughEarpiece: false, // 메인 스피커 사용
        });
      } catch (error) {
        console.error('오디오 세션 초기화 실패:', error);
      }
    };

    initializeAudioSession();
  }, []);

  useEffect(() => {
    let timer;
    if (isRecording) {
      timer = setInterval(() => {
        setRecordingTime((prevTime) => prevTime + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(timer);
  }, [isRecording]);


  const startRecording = async () => {
    setIsRecording(true);
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 거부', '녹음을 사용하기 위해 권한이 필요합니다.');
        return;
      }

      const { recording: newRecording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.mp4',
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
          sampleRate: 16000,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
          audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
        },
      });

      setRecording(newRecording);
    } catch (err) {
      console.error('녹음 시작 실패:', err);
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecordingURI(uri);
      setLoading(true);
      await sendRecordingToAPI(uri);
    } catch (error) {
      console.error('녹음 중지 실패:', error);
    } finally {
      setRecording(undefined);
    }
  };

  const playSound = async () => {
    if (!recordingURI) {
      Alert.alert('재생 오류', '먼저 녹음된 파일이 필요합니다.');
      return;
    }
    try {
      const { sound: newSound, status } = await Audio.Sound.createAsync({ uri: recordingURI });
      setSound(newSound);
      setIsPlaying(true);
      setSoundDuration(status.durationMillis);
      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded) {
          setSoundPosition(status.positionMillis);
        }
      });
      await newSound.playAsync();
    } catch (error) {
      console.error('재생 오류:', error);
    }
  };

  const pauseSound = async () => {
    if (sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    return sound ? () => {
      sound.unloadAsync();
    } : undefined;
  }, [sound]);

   const sendRecordingToAPI = async (uri) => {
    const controller = new AbortController(); // AbortController 생성
    setAbortController(controller); // 상태에 저장
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();

      reader.onloadend = async () => {
        const audioData = reader.result.split(',')[1];
        const requestBody = {
          argument: {
            language_code: languageCode,
            audio: audioData,
          },
        };

        console.log('API에 요청 전송 중:', requestBody);

        const apiResponse = await fetch('http://aiopen.etri.re.kr:8000/WiseASR/Pronunciation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': accessKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal, // AbortController의 signal 전달
        });

        setLoading(false);

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          console.error('API 요청 실패:', apiResponse.status, errorText);
          Alert.alert('API 호출 실패', `오류: ${apiResponse.status} ${errorText}`);
          return;
        }

        const jsonResponse = await apiResponse.json();
        if (jsonResponse.result === 0) {
          const recognized = jsonResponse.return_object.recognized;
          const score = jsonResponse.return_object.score;
          setRecognizedText(recognized);
          setPronunciationScore(score);
          setShowResult(true);

          // 결과창 애니메이션
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }),
          ]).start();
        } else {
          Alert.alert('API 호출 실패', `오류: ${jsonResponse.reason}`);
        }
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('API 호출이 취소되었습니다.');
        Alert.alert('취소됨', '요청이 취소되었습니다.');
      } else {
        console.error('API 전송 오류:', error);
        Alert.alert('API 호출 오류', '녹음된 파일을 전송하는 데 오류가 발생했습니다.');
      }
      setLoading(false);
    }
  };

  // 취소 버튼을 누르면 호출되는 함수
  const cancelRequest = () => {
    if (abortController) {
      abortController.abort(); // 요청 중단
      setAbortController(null); // controller 초기화
      setLoading(false); // 로딩 중지
    }
  };

  const handleSliderValueChange = async (value) => {
    setSoundPosition(value);
    if (sound) {
      await sound.setPositionAsync(value);
    }
  };

  const handlePlayPause = async () => {
    if (isPlaying) {
      await pauseSound();
    } else {
      await playSound();
    }
  };

  const closeResult = () => {
    setShowResult(false);
    setRecognizedText('');
    setPronunciationScore('');
    slideAnim.setValue(100); // 애니메이션 초기화
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return gestureState.dy > 10; // 아래로 드래그
      },
      onPanResponderMove: (evt, gestureState) => {
        // 드래그에 따라 결과창 이동
        slideAnim.setValue(gestureState.dy);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100) {
          closeResult(); // 아래로 드래그가 일정 기준 이상이면 닫기
        } else {
          // 드래그를 원위치로 되돌리기
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const animatedResultStyle = {
    opacity: fadeAnim,
    transform: [{ translateY: slideAnim }],
  };

const CircularScore = ({ score }) => {
  const radius = 100; // 원 반지름
  const strokeWidth = 15; // 원 테두리 두께
  const normalizedRadius = radius - strokeWidth * 0.5; // 실제 반지름
  const circumference = normalizedRadius * 2 * Math.PI; // 원 둘레

  const progress = isNaN(score) ? 0 : score / 100; // 점수 비율
  const strokeDashoffset = isNaN(score) ? circumference : circumference - progress * circumference; // 채워진 길이

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg height={250} width={250}>
        <G rotation="-90" origin="125, 125">
          <Circle
            stroke="#E0E0E0"
            fill="transparent"
            strokeWidth={strokeWidth}
            r={normalizedRadius}
            cx="125"
            cy="125"
          />
          <Circle
            stroke="#A8E2D0"
            fill="transparent"
            strokeWidth={strokeWidth}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            r={normalizedRadius}
            cx="125"
            cy="125"
          />
        </G>
      </Svg>
      <Text style={styles.scoreText}>{score}</Text>
    </View>
  );
};

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.header}>Pronunciation Rater</Text>
      </View>
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.circleButton, recording ? styles.recording : null]}
          onPress={recording ? stopRecording : startRecording}
        >
          <MaterialIcons
            name="mic"
            size={100}
            color={isRecording ? '#FF6F61' : '#66D6B2'}
          />
        </TouchableOpacity>
        {isRecording ? (
          <>
            <Text style={styles.recordingText}>녹음 중...</Text>
            <Text style={styles.recordingTime}>{recordingTime}초</Text>
          </>
        ) : !loading && (
          <Text style={styles.instructions}>녹음을 시작하려면 버튼을 누르세요</Text>
        )}
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>채점 중...</Text>
          <TouchableOpacity onPress={cancelRequest} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>취소</Text>
          </TouchableOpacity>
        </View>
      )}


  {showResult && (
    <Animated.View style={[styles.resultContainer, animatedResultStyle]} {...panResponder.panHandlers}>
    <View style={styles.grayBar} />
    <Text style={styles.resultHeader}>채점 결과</Text>
    <Text style={styles.feedbackText}>
      {pronunciationScore * 20 < 25
        ? '★\n노력이 필요해요'
        : pronunciationScore * 20 < 40
        ? '★★\n나쁘지 않아요'
        : pronunciationScore * 20 < 60
        ? '★★★\n좋아요!'
        : pronunciationScore * 20 < 80
        ? '★★★★\n훌륭해요!'
        : pronunciationScore * 20 <= 100
        ? '★★★★★\n완벽해요요!'
        : '분석 실패'}
    </Text>
     <Text style={styles.detailText}>{"\n\n"}점수</Text>
    <CircularScore 
      score = {Math.round(pronunciationScore * 20)} 
    />
      <Text style={styles.perfectscore}>/100</Text>
      <Text style={styles.detailText}>발음 분석</Text>
      <View style={styles.recognizedTextContainer}>
      <Text style={styles.recognizedText}>{recognizedText}</Text>
      </View>
          <View style={styles.playerContainer}>
            <TouchableOpacity onPress={handlePlayPause} style={styles.playButton}>
              <MaterialIcons name={isPlaying ? "pause" : "play-arrow"} size={40} color="#000000" />
            </TouchableOpacity>
            <Text style={styles.playbackTime}>{`${Math.floor(soundPosition / 1000)}초`}</Text>
            <Slider
              style={styles.slider}
              value={soundPosition}
              minimumValue={0}
              maximumValue={soundDuration}
              minimumTrackTintColor="#66D6B2" // 재생 바 색상
              maximumTrackTintColor="#D3D3D3" // 최대 값 색상
              onValueChange={handleSliderValueChange}
            />
            <Text style={styles.playbackTime}>{`${Math.floor(soundDuration / 1000)}초`}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    position: 'relative',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center', // 중앙 정렬
  },
  header: {
    color: '#66D6B2',
    fontWeight: 'bold',
    fontSize: 35,
    marginBottom: 50,
    position: 'absolute',
    top: 40,
    left: 10,
  },
  buttonContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  circleButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#FFFFFF', // 흰색 배경
    borderColor: '#A8E2D0', // 민트색 테두리
    borderWidth: 5, // 테두리 두께
    marginBottom: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000', // 그림자 색상
    shadowOffset: {
      width: 0,
      height: 2, // 그림자 위치
    },
    shadowOpacity: 0.3, // 그림자 불투명도
    shadowRadius: 5, // 그림자 퍼짐 정도
    elevation: 5, // 안드로이드에서 그림자 효과
  },
  recording: {
    borderColor: '#FFB2B2',
  },
  recordingText: {
    fontSize: 30,
    color: '#FF6F61', // 빨간색
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  recordingTime: {
    fontSize: 25,
    color: '#000000', // 검은색
    textAlign: 'center',
  },
  instructions: {
    marginTop: 10,
    fontSize: 20,
    textAlign: 'center',
  },
  loadingContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  loadingText: {
    fontSize: 20,
    marginTop: 10,
  },
  cancelButton: {
    marginTop: 50,
    padding: 10,
    backgroundColor: '#FFFFFF', // 흰색 배경
    borderColor: '#FF6F61',
    borderWidth: 1, // 테두리 두께
    borderRadius: 5,
  },
  cancelButtonText: {
    color: '#FF6F61',
    fontSize: 18,
    textAlign: 'center',
  },
  resultContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    weight: '90%',
    height: '80%', // 높이 조정
    padding: 20,
    backgroundColor: '#F7F7F7',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    justifyContent: 'center', // 중앙 정렬
    alignItems: 'center', // 중앙 정렬
  },
  grayBar: {
    width: '10%',
    height: 5,
    position: 'absolute',
    top: 10,
    backgroundColor: '#D3D3D3', // 회색 바 색상
    marginBottom: 30,
    borderRadius: 5, // 모서리 둥글게
  },
  scoreText: {
    fontSize: 90,
    fontWeight: 'bold',
    color: '#66D6B2',
    position: 'absolute',
    top: '30%', // 중앙에 위치시키기
  },  
  perfectscore: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
    position: 'absolute',
    top: '55%', // 중앙에 위치시키기
  },
  feedbackText: {
    fontSize: 25,
    textAlign: 'center',
    color: '#3EB489',
  },
  recognizedTextContainer: {
    backgroundColor: '#B2F2E2',
    padding: 10, // 여백 추가
    borderRadius: 5, // 모서리 둥글게
    shadowColor: '#000', // 그림자 색상
    shadowOffset: {
    width: 0,
    height: 1,
  },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2, // 안드로이드에서 그림자가 보이도록
    marginVertical: 10, // 위아래 여백 추가
  },
  recognizedText: {
    fontSize: 16,
    marginVertical: 10,
    textAlign: 'center',
  },
  detailText: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
  },
  resultHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  playerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playButton: {
    padding: 10,
  },
  playbackTime: {
    fontSize: 16,
    marginHorizontal: 10,
  },
  slider: {
    flex: 1,
  },
});

export default App;