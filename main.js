import Wav from './wav.js';

const Peaks = peaks;

const sampleRate = 44100;
const channels = 1;
// const url = "./marriage.wav";
const url = './wolverine.mp3';

let offlineCtx;
let loaded = false;
let modifiedWaveform;
let waveformPoints = [];

let chunkSize = 1024;
// Number of chunks in a row that need to be below threshold for it to trigger
let triggerLength = 10;
// Number of chunks to close the gate for once it's triggered
let holdLength = 10;
let threshold = 0.003;
let minSectionSamples = 20;
let cleanSignal = 3;

let averageVolume = 0;
let rmsChunks;

let audioBuffer;

const chunkSizeInput = document.querySelector('#chunkSize');
const holdLengthInput = document.querySelector('#holdLength');
const triggerLengthInput = document.querySelector('#triggerLength');
const thresholdInput = document.querySelector('#threshold');
const cleanSignalInput = document.querySelector('#cleanSignal');
const minSectionSamplesInput = document.querySelector('#minSectionSamples');
const averageVolumeSpan = document.querySelector('#averageVolume');

const updateForm = () => {
  chunkSizeInput.value = chunkSize;
  thresholdInput.value = threshold;
  triggerLengthInput.value = triggerLength;
  holdLengthInput.value = holdLength;
  minSectionSamplesInput.value = minSectionSamples;
  cleanSignalInput.value = cleanSignal;
  averageVolumeSpan.textContent = averageVolume;
};

const getValuesFromForm = () => {
  try {
    chunkSize = parseFloat(chunkSizeInput.value);
    threshold = parseFloat(thresholdInput.value);
    holdLength = parseFloat(holdLengthInput.value);
    minSectionSamples = parseFloat(minSectionSamplesInput.value);
    cleanSignal = parseFloat(cleanSignalInput.value);
    triggerLength = parseFloat(triggerLengthInput.value);
  } catch {
    console.log('Invalid parameters');
  }
};

const process = (dryRun) => {
  getValuesFromForm();
  extractChannelData(detectBreaks(dryRun))(audioBuffer)
    .then(connectToAudioTag);
};

document.querySelector('#process').onclick = () => process(false);

document.querySelector('#dryRun').onclick = () => process(true);

originalAudio.src = url;
originalAudio.addEventListener('canplaythrough', () => {
  if (!loaded) {
    loaded = true;
    const seconds = Math.round(originalAudio.duration);
    
    offlineCtx = new OfflineAudioContext(channels, seconds * sampleRate, sampleRate);

    fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => offlineCtx.decodeAudioData(buffer))
      .then(filterAudio)
      .then(getAverageRMS)
      .then(buffer => {
        audioBuffer = buffer;
        return Promise.resolve(buffer);
      })
      .then(connectToAudioTag);
  }
});

const setupModifiedWaveform = () => {
  console.log('setting up');
  const context = new AudioContext();

  modifiedWaveform = Peaks.init({
    container: document.querySelector('#modifiedWaveform'),
    mediaElement: document.querySelector('#modifiedAudio'),
    audioContext: context
  });
  
  modifiedWaveform.points.add(waveformPoints);

  setTimeout(() => {
      document
        .querySelectorAll('.overview-container')
        .forEach(element => element.remove());
      modifiedAudio.removeEventListener('canplaythrough', setupModifiedWaveform);
    },
    200
  );
};

const addPoint = (samplePosition, label) => {
  waveformPoints.push({
    time: samplePosition / 44100,
    labelText: label
  });
};

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

const limitAudio = (data, newData) => {
  if (!rmsChunks) {
    return;
  }

  const maxValue = rmsChunks.reduce((prev, next) => Math.max(Math.abs(prev), Math.abs(next)), 0.0);
  const scalingFactor = (1 / maxValue) * 0.5;

  console.log('Max:', maxValue);
  console.log('Scaling:', scalingFactor);

  let clipping = 0;
  for (let i = 0; i < newData.length; i++) {
    for (let j = 0; j < newData[0].length; j++) {
      newData[i][j] = Math.min(data[i][j] * scalingFactor, 1);

      if (newData[i][j] === 1) {
        clipping++;
      }
    }
  }

  console.log('Clipping:', clipping);
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

const extractChannelData = process => buffer => {
  // Extract raw samples from buffer
  const { numberOfChannels, length, sampleRate } = buffer;
  // Define arrays so we can hold multiple channels
  const data = [];
  const newData = [];

  for (let i = 0; i < numberOfChannels; i++) {
    data.push(buffer.getChannelData(i));
    newData.push(new Float32Array(buffer.length));
  }

  // Process the samples (mutates newData)
  const t0 = performance.now();
  process(data, newData);
  const t1 = performance.now();
  const roundedTelemetry = Math.round((t1 - t0) * 10) / 10;

  // Create new buffer from new samples
  const newBuffer = new AudioBuffer({
    length,
    numberOfChannels,
    sampleRate
  });

  for (let i = 0; i < numberOfChannels; i++) {
    newBuffer.copyToChannel(newData[i], i);
  }

  console.log(`Processed (${process.name}) in: ${roundedTelemetry}ms`);
  return Promise.resolve(newBuffer);
};

const getAverageRMS = buffer => {
  rmsChunks = getRMSChunks(buffer.getChannelData(0), chunkSize);
  averageVolume = rmsChunks.reduce((prev, next) => prev + next, 0) / rmsChunks.length;

  updateForm();

  return Promise.resolve(buffer);
};

/**
 * Remove samples when the level drops below a threshold
 * @param {Float32Array} buffer 
 */
const detectBreaks = dryRun => (data, newData) => {
  let pos = 0;

  // Average rms
  // const rmsWindow = 50;
  // pos = 5;
  // while (pos < newData[0].length) {
  //   let sum = 0;
  //   for (let i = 1; i <= rmsWindow; i++) {
  //     sum += data[0][pos - i];
  //     sum += data[0][pos + i];
  //   }

  //   newData[0][pos] = sum / (rmsWindow * 2);
  //   pos++;
  // }
  
  pos = 0;
  while (pos < data[0].length) {
    newData[0][pos] = Math.abs(data[0][pos]) < threshold
      ? 0
      : data[0][pos] * 5;
    pos++;
  }

  // Remove sections that are too short
  pos = 0;
  let sectionStart = 0;
  let sectionLength = 0;
  let inSection = false;
  while (pos < newData[0].length) {
    if (newData[0][pos] > 0) {
      sectionLength++;

      if (!inSection) {
        inSection = true;
        sectionStart = pos;
      }
    } else {
      if (inSection && sectionLength < minSectionSamples) {
        for (let i = sectionStart; i < pos; i++) {
          newData[0][i] = 0;
        }
      }

      inSection = false;
      sectionLength = 0;
    }

    pos++;
  }

};

/**
 * Remove samples when the level drops below a threshold
 * @param {Float32Array} buffer 
 */
const gateRemove = dryRun => (data, newData) => {
  console.log(dryRun);
  const silence = (new Float32Array(chunkSize)).fill(0);
  const rmsChunks = getRMSChunks(data[0], chunkSize);

  waveformPoints = [];

  const totalAverage = rmsChunks.reduce((prev, next) => prev + next, 0) / rmsChunks.length;
  console.log("Total track RMS: ", totalAverage);

  let pos = 0;
  let oldPos = 0;
  let chunkPos = 0;
  let belowThresholdChunks = 0;
  let trigger;
  let prevTrigger;

  while (chunkPos < rmsChunks.length - holdLength) {
    const chunk = rmsChunks[chunkPos];
    if (chunk < threshold) {
      belowThresholdChunks++;
    } else {
      belowThresholdChunks = 0;
    }
  
    // Check if we trigger the noise gate closed
    prevTrigger = trigger;
    trigger = belowThresholdChunks >= triggerLength;


    if (dryRun) {
      if (trigger && !prevTrigger) {
        addPoint(oldPos, 'Close');
      } else if (!trigger && prevTrigger) {
        addPoint(oldPos, 'Open');
      }
    }

    if (trigger) {
      for (let i = 0; i < holdLength; i++) {
        if (dryRun) {
          newData[0].set(data[0].slice(oldPos, oldPos + chunkSize), pos);
          pos += chunkSize;
          oldPos += chunkSize;
          chunkPos++;
        } else {
          oldPos += chunkSize;
          chunkPos++;
        }
      }
    } else {
      newData[0].set(data[0].slice(oldPos, oldPos + chunkSize), pos);
      pos += chunkSize;
      oldPos += chunkSize;
      chunkPos++;
    }
  }

  const samplesSkipped = oldPos - pos;
  console.log(`Samples removed: ${samplesSkipped} (${samplesSkipped / 44100}s)`);
};

const gateWithWhiteNoise = buffer => {
  const t0 = performance.now();

  // const data = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const data = [buffer.getChannelData(0)];
  const newData = [
    new Float32Array(buffer.length),
    new Float32Array(buffer.length)
  ];

  // Insert whitenoise when the level drops below a threshold level
  const threshold = 0.015;
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
        // newData[1].set(whiteNoise, pos);
        pos += chunkSize;
        chunkPos++;
      }
    } else {
      newData[0].set(data[0].slice(pos, pos + chunkSize), pos);
      // newData[1].set(data[1].slice(pos, pos + chunkSize), pos);
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
  // newBuffer.copyToChannel(newData[1], 1);

  const t1 = performance.now();
  console.log('Processed (Gate) in:', t1 - t0);

  return Promise.resolve(newBuffer);
};

// const gateRemove = buffer => {
//   const t0 = performance.now();

//   // const data = [buffer.getChannelData(0), buffer.getChannelData(1)];
//   const data = [buffer.getChannelData(0)];
//   const newData = [
//     new Float32Array(buffer.length),
//     new Float32Array(buffer.length)
//   ];

//   // Insert whitenoise when the level drops below a threshold level
//   const threshold = 0.004;
//   const chunkSize = 1024;
//   // Number of chunks in a row that need to be below threshold for it to trigger
//   const triggerLength = 10;
//   // Number of chunks to close the gate for once it's triggered
//   const holdLength = 10;
//   const silence = (new Float32Array(chunkSize)).fill(0);
//   const rmsChunks = getRMSChunks(data[0], chunkSize);

//   const totalAverage = rmsChunks.reduce((prev, next) => prev + next, 0) / rmsChunks.length;
//   console.log("Total track RMS: ", totalAverage);

//   let pos = 0;
//   let oldPos = 0;
//   let chunkPos = 0;
//   let trigger;

//   while (chunkPos < rmsChunks.length - holdLength) {
//     trigger = false;
//     const chunk = rmsChunks[chunkPos];
  
//     // Check if we trigger the noise gate closed
//     if (chunk < threshold) {
//       trigger = true;
//       // Check if the next several chunks also fall below threshold
//       for (let i = 1; i <= triggerLength; i++) {
//         if (rmsChunks[chunkPos + i] >= threshold) {
//           trigger = false;
//         }
//       }
//     }

//     if (trigger) {
//       for (let i = 0; i < holdLength; i++) {
//         // const whiteNoise = generateWhiteNoise(chunkSize);
//         // newData[0].set(silence, pos);
//         // pos += chunkSize;
//         oldPos += chunkSize;
//         chunkPos++;
//       }
//     } else {
//       newData[0].set(data[0].slice(oldPos, oldPos + chunkSize), pos);
//       // newData[1].set(data[1].slice(pos, pos + chunkSize), pos);
//       pos += chunkSize;
//       oldPos += chunkSize;
//       chunkPos++;
//     }
//   }

//   const newBuffer = new AudioBuffer({
//     length: buffer.length,
//     numberOfChannels: buffer.numberOfChannels,
//     sampleRate: buffer.sampleRate
//   });

//   newBuffer.copyToChannel(newData[0], 0);
//   // newBuffer.copyToChannel(newData[1], 1);

//   const t1 = performance.now();
//   console.log('Processed (GateRemove) in:', t1 - t0);

//   return Promise.resolve(newBuffer);
// };

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
  modifiedAudio.src = URL.createObjectURL(blob);
  modifiedAudio.addEventListener('canplaythrough', setupModifiedWaveform);
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

