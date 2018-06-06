import Wav from './wav.js';

const sampleRate = 44100;
const audioTag = audio;
const url = "./sandstorm.mp3";
// const url = "./speaker-6.wav";

let offlineCtx;
let loaded = false;

audioTag.src = url;
audioTag.volume = 0.3;
audioTag.addEventListener('canplaythrough', () => {
  if (!loaded) {
    loaded = true;
    const seconds = Math.round(audioTag.duration);
    audioTag.src = '';
    
    offlineCtx = new OfflineAudioContext(2, seconds * sampleRate, sampleRate);
    
    fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => offlineCtx.decodeAudioData(buffer))
      // .then(calculateRMS)
      .then(gateWithWhiteNoise)
      // .then(insertWhiteNoise)
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

const generateWhiteNoise = length => {
  const data = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    data[i] = ((Math.random() * 2.0) - 1.0) / 8;
  }

  return data;
};

/**
 * @param {ArrayBuffer} buffer 
 * @param {int} chunkSize 
 */
const getRMSChunks = (buffer, chunkSize=1024) => {
  const rmsChunks = [];

  let pos = 0;
  let chunk;
  let sum;
  while (pos + chunkSize < buffer.length) {
    sum = 0;
    chunk = buffer.slice(pos, pos + chunkSize);

    for (let i = 0; i < chunkSize; i++) {
      sum += buffer[pos + i] * buffer[pos + i];
    }
    
    rmsChunks.push(Math.sqrt(sum / chunkSize));
    pos += chunkSize;
  }

  return rmsChunks;
};

const gateWithWhiteNoise = buffer => {
  const t0 = performance.now();

  const data = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const newData = [
    new Float32Array(buffer.length),
    new Float32Array(buffer.length)
  ];

  // Insert whitenoise when the level drops below a threshold level
  const threshold = 0.15;
  const chunkSize = 1024;
  // Number of chunks in a row that need to be below threshold for it to trigger
  const triggerLength = 10;
  // Number of chunks to close the gate for once it's triggered
  const holdLength = 10;
  const silence = (new Float32Array(chunkSize)).fill(0);
  const rmsChunks = getRMSChunks(data[0], chunkSize);

  const totalAverage = rmsChunks.reduce((prev, next) => prev + next, 0) / rmsChunks.length;
  console.log("Total track RMS: ", totalAverage);

  let pos = 0;
  let chunkPos = 0;
  let trigger;

  while (chunkPos < rmsChunks.length - holdLength) {
    trigger = false;
    const chunk = rmsChunks[chunkPos];
  
    // Check if we trigger the noise gate closed
    if (chunk < threshold) {
      trigger = true;
      // Check if the next several chunks also fall below threshold
      for (let i = 1; i <= triggerLength; i++) {
        if (rmsChunks[chunkPos + i] >= threshold) {
          trigger = false;
        }
      }
    }

    if (trigger) {
      for (let i = 0; i < holdLength; i++) {
        const whiteNoise = generateWhiteNoise(chunkSize);
        newData[0].set(whiteNoise, pos);
        newData[1].set(whiteNoise, pos);
        pos += chunkSize;
        chunkPos++;
      }
    } else {
      newData[0].set(data[0].slice(pos, pos + chunkSize), pos);
      newData[1].set(data[1].slice(pos, pos + chunkSize), pos);
      pos += chunkSize;
      chunkPos++;
    }
  }

  const newBuffer = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate
  });

  newBuffer.copyToChannel(newData[0], 0);
  newBuffer.copyToChannel(newData[1], 1);

  const t1 = performance.now();
  console.log('Processed (Gate) in:', t1 - t0);

  return Promise.resolve(newBuffer);
};

const calculateRMS = buffer => {
  const rmsChunks = getRMSChunks(buffer.getChannelData(0));
  const totalAverage = rmsChunks.reduce((prev, next) => prev + next, 0) / rmsChunks.length;

  console.log("Total track RMS: ", totalAverage);
  rmsChunks.forEach((chunk, i) => console.log(i + ' : ' + Math.round(chunk * 100)));

  return Promise.resolve(buffer);
};

const insertWhiteNoise = buffer => {
  const t0 = performance.now();

  const data = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const newData = [
    new Float32Array(buffer.length),
    new Float32Array(buffer.length)
  ];

  let oldPos = 0;
  let newPos = 0;
  const whiteNoise = generateWhiteNoise(sampleRate / 10);
  while (oldPos < buffer.length) {
    // Every second we skip forward a full second
    if (oldPos % sampleRate === 0 && (oldPos + sampleRate) < newData[0].length) {
      oldPos += sampleRate;

      // Add in whitenoise
      newData[0].set(whiteNoise, newPos);
      newData[1].set(whiteNoise, newPos);

      newPos += sampleRate / 10;
    }

    newData[0][newPos] = data[0][oldPos];
    newData[1][newPos] = data[1][oldPos];

    oldPos++;
    newPos++;
  }

  const newBuffer = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate
  });

  newBuffer.copyToChannel(newData[0], 0);
  newBuffer.copyToChannel(newData[1], 1);

  const t1 = performance.now();
  console.log('Processed (InsertWhiteNoise) in:', t1 - t0);

  return Promise.resolve(newBuffer);
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

