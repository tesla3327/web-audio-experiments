import Wav from './wav.js';

const sampleRate = 44100;
const audioTag = audio;
const url = "./sandstorm.mp3";
// const url = "./speaker-6.wav";

let offlineCtx;
let loaded = false;

audioTag.src = url;
audioTag.addEventListener('canplaythrough', () => {
  if (!loaded) {
    loaded = true;
    const seconds = Math.round(audioTag.duration);
    
    offlineCtx = new OfflineAudioContext(2, seconds * sampleRate, sampleRate);
    
    fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => offlineCtx.decodeAudioData(buffer))
      .then(filterAudio)
      .then(removeChunkOfSamples)
      // .then(playAudio);
      .then(connectToAudioTag);
  }
});

const filterAudio = data => {
  const source = offlineCtx.createBufferSource();
  source.buffer = data;

  const lowpass = offlineCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 5000;
  lowpass.Q.value = 1;

  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 200;
  highpass.Q.value = 1;

  source.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(offlineCtx.destination);

  source.start();
  return offlineCtx.startRendering();
};

const removeLeftChannel = buffer => {
  const samples = new Float32Array(30 * sampleRate);
  buffer.copyToChannel(samples, 0);
  return Promise.resolve(buffer);
};

const removeChunkOfSamples = buffer => {
  const samples = [buffer.getChannelData(0), buffer.getChannelData(1)];

  let mute = false;
  let offsetForward = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (i % sampleRate === 0) {
      offsetForward += sampleRate;
      mute = !mute;
    }

    samples[0][i] = samples[0][i + offsetForward];
    samples[1][i] = samples[1][i + offsetForward];
  }

  return Promise.resolve(buffer);
};

const playAudio = buffer => {
  const onlineCtx = new AudioContext();
  
  const song = onlineCtx.createBufferSource();
  song.buffer = buffer;
  song.connect(onlineCtx.destination);
  song.start();

  song.onended = () => console.log('Song has ended');
};

const connectToAudioTag = buffer => {;
  const wav = new Wav({ sampleRate, channels: 1 });

  wav.setBuffer(buffer.getChannelData(0));

  const srclist = [];
  while(!wav.eof()){
    srclist.push(wav.getBuffer(1000));
  }

  const blob = new Blob(srclist, { type: 'audio/wav' });
  audioTag.src = URL.createObjectURL(blob);
};

const processFromAudioTag = tag => {
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(tag);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 2000;
  lowpass.Q.value = 1;

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 200;
  highpass.Q.value = 1;

  source.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(ctx.destination);
};

const processAudio = () => {
  const context = new AudioContext();
  const source = context.createMediaElementSource(audioTag);
  const destination = context.createMediaStreamDestination();
  const mediaRecorder = new MediaRecorder(destination.stream);

  console.log(source.buffer);
}

// button.onclick = processAudio;

