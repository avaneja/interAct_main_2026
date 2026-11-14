// Types for the parts of TalkingHead (https://github.com/met4citizen/TalkingHead) that InterAct uses.
// The package ships plain JavaScript.
declare module '@met4citizen/talkinghead' {
  export interface TalkingHeadOptions {
    lipsyncModules?: string[]
    lipsyncLang?: string
    cameraView?: 'full' | 'mid' | 'upper' | 'head'
    cameraRotateEnable?: boolean
    cameraPanEnable?: boolean
    cameraZoomEnable?: boolean
    modelFPS?: number
    modelPixelRatio?: number
    avatarMood?: string
    avatarIdleEyeContact?: number
    avatarIdleHeadMove?: number
    avatarSpeakingEyeContact?: number
    avatarSpeakingHeadMove?: number
  }

  export interface AvatarOptions {
    url: string
    body?: 'M' | 'F'
    avatarMood?: string
    lipsyncLang?: string
  }

  /** Audio plus word and viseme timings in milliseconds, as produced by HeadTTS. */
  export interface SpeechAudio {
    audio: AudioBuffer
    words: string[]
    wtimes: number[]
    wdurations: number[]
    visemes?: string[]
    vtimes?: number[]
    vdurations?: number[]
  }

  export class TalkingHead {
    constructor(node: HTMLElement, options?: TalkingHeadOptions)
    readonly audioCtx: AudioContext
    isSpeaking: boolean
    showAvatar(avatar: AvatarOptions, onprogress?: ((event: ProgressEvent) => void) | null): Promise<void>
    speakAudio(speech: SpeechAudio, options?: object | null, onsubtitles?: ((word: string) => void) | null): void
    speakMarker(onmarker: () => void): void
    stopSpeaking(): void
    start(): void
    stop(): void
    dispose(): void
  }
}
