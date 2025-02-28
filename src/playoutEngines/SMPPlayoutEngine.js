// @flow
/* eslint-disable class-methods-use-this */
/* eslint-disable no-unused-vars */
import { v4 as uuid } from 'uuid';
import EventEmitter from 'events';
import Player, { PlayerEvents } from '../gui/Player';
import logger from '../logger';
import { MediaFormats } from '../browserCapabilities'
import { PLAYOUT_ENGINES } from './playoutEngineConsts'
import BasePlayoutEngine, { MEDIA_TYPES, SUPPORT_FLAGS } from './BasePlayoutEngine';
import DOMSwitchPlayoutEngine from './DOMSwitchPlayoutEngine';
import IOSPlayoutEngine from './iOSPlayoutEngine';
import { getSMPInterface } from '../utils'

const AUDIO_MIX_EVENT_LABEL = 'smp_mix';

class SMPPlayoutEngine extends BasePlayoutEngine {
    _secondaryPlayoutEngine: BasePlayoutEngine

    _playing: boolean;

    _smpPlayerInterface: Object

    _fakeItemRendererId: ?string

    _fakeItemDuration: number

    _fakeItemLoaded: boolean

    _fakeEventEmitter: Object

    constructor(player: Player) {
        super(player);

        // Get Playout Engine to use for BackgroundAudio
        this._createSecondaryPlayoutEngine(player);

        this._smpPlayerInterface.addEventListener("pause", (event) => {
            // Hack to update playing status from SMP
            if(!event.ended && event.paused) {
                this.pause(false);
            }
        })

        // Play Button
        this._smpPlayerInterface.addEventListener("play", () => {
            // Hack to update playing status from SMP
            this.play(false);
        })

        this._fakeItemRendererId = null
        this._fakeItemDuration = -1
        this._fakeItemLoaded = false
        this._fakeEventEmitter = new EventEmitter();

        this._smpPlayerInterface.addEventListener("play", (e) => {
            this._fakeEventEmitter.emit("play", e);
        });
        this._smpPlayerInterface.addEventListener("pause", (e) => {
            this._fakeEventEmitter.emit("pause", e);
        });

        this._volume = 1;
        this._backgroundMix = 1;

        this._handleVolumePersistence = this._handleVolumePersistence.bind(this);
        this._handleVolumeChange = this._handleVolumeChange.bind(this);
        this._smpPlayerInterface.addEventListener("volumechange", this._handleVolumeChange);

        this._smpFakePlay = this._smpFakePlay.bind(this);
        this._smpFakePause = this._smpFakePause.bind(this);
        this._smpFakeLoad = this._smpFakeLoad.bind(this);
        this._player.on(
            PlayerEvents.VOLUME_CHANGED,
            this._handleVolumePersistence,
        );
    }

    _handleVolumePersistence(e) {
        if (e.label === AUDIO_MIX_EVENT_LABEL) {
            this.setFbMix(e.value);
        }
    }

    _handleVolumeChange(e) {
        let { volume } = e
        if(e.muted) {
            volume = 0
        }
        this._volume = volume;
        const backgroundAudioVolume = this._volume * this._backgroundMix;
        this._secondaryPlayoutEngine.setAllVolume(backgroundAudioVolume);
    }

    _createSecondaryPlayoutEngine(player: Player) {
        const playoutToUse = MediaFormats.getPlayoutEngine(true);

        logger.info('SMP: Using backup playout engine: ', playoutToUse);

        this._smpPlayerInterface = getSMPInterface();

        switch (playoutToUse) {
        case PLAYOUT_ENGINES.DOM_SWITCH_PLAYOUT:
            // Use shiny source switching engine.... smooth.
            this._secondaryPlayoutEngine = new DOMSwitchPlayoutEngine(player);
            break;
        case PLAYOUT_ENGINES.IOS_PLAYOUT:
            // Refactored iOS playout engine
            this._secondaryPlayoutEngine = new IOSPlayoutEngine(player);
            break;
        default:
            logger.fatal('Invalid Playout Engine');
            throw new Error('Invalid Playout Engine');
        }
    }

    setFbMix(fbMixValue) {
        this._backgroundMix = fbMixValue
        const backgroundAudioVolume = this._volume * this._backgroundMix
        this._secondaryPlayoutEngine.setAllVolume(backgroundAudioVolume)
        this._player.emit(
            PlayerEvents.AUDIO_MIX_CHANGED,
            { id: AUDIO_MIX_EVENT_LABEL, label: AUDIO_MIX_EVENT_LABEL, value: fbMixValue },
        );
    }

    supports(feature: string) {
        switch(feature) {
        case SUPPORT_FLAGS.SUPPORTS_360:
            return false
        default:
            return false
        }
    }

    setPermissionToPlay(value: boolean, startNow: boolean) {
        this._secondaryPlayoutEngine.setPermissionToPlay(value)
        super.setPermissionToPlay(value)

        // TODO: first active playout is not set to autoplay so we have to
        // manually start it here. We will need to test this on iOS as I'd
        // expect it to not work correctly
        if (value) this.play()
        if (!startNow) this.pause()
    }

    async queuePlayout(rendererId: string, mediaObj: Object) {
        if(mediaObj.type === MEDIA_TYPES.BACKGROUND_A) {
            // Handle with Secondary Playout
            this._secondaryPlayoutEngine.queuePlayout(rendererId, mediaObj)
            return
        }

        const isTrimmed = mediaObj.inTime > 0 || mediaObj.outTime > 0;

        // TODO: Get MediaFetcher to not resolve pids
        super.queuePlayout(rendererId, mediaObj);

        const options = {
            loop: false,
            ondemandWebcastData: isTrimmed,
        };
        if("loop" in this._media[rendererId].media && this._media[rendererId].media.loop) {
            this.setLoopAttribute(rendererId, true);
            options.loop = true;
        }

        const { url } = this._media[rendererId].media
        let playlistItem = {}
        // Check if we have subtitles and that they are EBU-TT-D and not WebVTT
        if(
            "subs_url" in this._media[rendererId].media
        ) {
            // eslint-disable-next-line no-restricted-globals
            const isPublishedExperience = parent.location.href.includes('/experience/');
            const subsAreEbuttFormat = await fetch(
                this._media[rendererId].media.subs_url,
                {
                    credentials: isPublishedExperience ? "same-origin": "include"
                }
            )
                .then(res => res.text())
                .then(text => text.includes('xmlns="http://www.w3.org/ns/ttml"')); // is this too much?  too little?
            if (subsAreEbuttFormat) playlistItem.captionsUrl = this._media[rendererId].media.subs_url;
        }

        let kind = "programme"
        if(mediaObj.type === MEDIA_TYPES.FOREGROUND_A) {
            kind = "audio"
        }
        if (url.indexOf('http') !== 0) {
            playlistItem = {
                ...playlistItem,
                versionID: url,
                kind,
            }
        } else if(url.indexOf('.mpd') !== -1) {
            playlistItem = {
                ...playlistItem,
                href:[{"url":url,"format":"dash"}],
                kind,
            }
        } else {
            playlistItem = {
                ...playlistItem,
                href:url,
                kind,
            };
        }

        if (isTrimmed) {
            playlistItem = {
                ...playlistItem,
                in: mediaObj.inTime > 0 ? mediaObj.inTime : 0,
            }
        }
        if (isTrimmed && mediaObj.outTime > 0) {
            playlistItem = {
                ...playlistItem,
                out: mediaObj.outTime,
            }
        }

        const playlist = {
            summary: rendererId,
            options,
            config: {
                ondemandWebcastData: isTrimmed,
                autoplay: true,
            },
            playlist: {
                id: rendererId,
                items:[playlistItem]
            }
        }

        const isPid = /^[a-z0-9]{8}$/.test(url);
        playlist.options.useCredentials = isPid ? false : ["MPD", "InitializationSegment", "MediaSegment", "Player"];

        logger.info(`SMP-SP readyPlaylist: ${rendererId}`)
        this._smpPlayerInterface.readyPlaylist(playlist)
        logger.info(`SMP-SP preloadFromCollection: ${rendererId}`)
        this._smpPlayerInterface.preloadFromCollection(rendererId)
    }

    unqueuePlayout(rendererId: string) {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.unqueuePlayout(rendererId)
        }
        return super.unqueuePlayout(rendererId)
    }

    setPlayoutVisible(rendererId: string) {
        const rendererPlayoutObj = this._media[rendererId];
        this._smpPlayerInterface.loadPlaylistFromCollection(rendererId, true);
        this._media[rendererId].loadedPlaylist = true;
        this._smpPlayerInterface.pauseAt([0]);

        if(!rendererPlayoutObj) {
            this._secondaryPlayoutEngine.setPlayoutVisible(rendererId)
        }
    }

    getPlayoutActive(rendererId: string): boolean {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.getPlayoutActive(rendererId)
        }
        return super.getPlayoutActive(rendererId)
    }

    resetPlayoutEngine() {
        this._secondaryPlayoutEngine.pause();
        this._smpPlayerInterface.stop();
    }

    setPlayoutActive(rendererId: string) {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            this._secondaryPlayoutEngine.setPlayoutActive(rendererId)
            return
        }

        if(this._permissionToPlay) {
            // If permission to play granted then autostart playlist and
            // then pause if we are not currently playing
            if (this._media[rendererId].loadedPlaylist) {
                // we have loaded and paused at 0; since should be autoplaying, play
                this._smpPlayerInterface.play();
            } else {
                this._smpPlayerInterface.loadPlaylistFromCollection(rendererId, true);
            }
            if(!this._playing) {
                const pauseFunction = () => {
                    this._smpPlayerInterface.removeEventListener("playing", pauseFunction)
                    this._smpPlayerInterface.pause()
                }
                this._smpPlayerInterface.addEventListener("playing", pauseFunction)
            }
        } else if (!this._media[rendererId].loadedPlaylist)  {
            // If permission to play not granted then just load playlist without
            // playing
            this._smpPlayerInterface.loadPlaylistFromCollection(rendererId, false);
        }
        if (!rendererPlayoutObj.active) {
            logger.info(`Applying queued events for ${rendererId}`)
            if (rendererPlayoutObj.queuedEvents) {
                rendererPlayoutObj.queuedEvents.forEach((qe) => {
                    this._smpPlayerInterface.addEventListener(qe.event, qe.callback)
                })
            }
            rendererPlayoutObj.queuedEvents = []
        }
        if(this._media[rendererId].media.type === MEDIA_TYPES.FOREGROUND_A) {
            this._player.mediaTarget.classList.add('romper-audio-element');
        }
        super.setPlayoutActive(rendererId)
        logger.info(`SMP-SP setPlayoutActive: ${rendererId}`)
    }

    _smpFakePlay() {
        const mi = this._smpPlayerInterface.currentItem;
        if (mi && mi.fake) {
            this._smpPlayerInterface.dispatchEvent({
                type: "playing",
                fake: true
            });
            if(this._fakeItemLoaded === false) {
                // This is playRequested event when playlist is first queued. We
                // don't want to emit play or change the playout engine playing
                // status for this first event
                this._fakeItemLoaded = true
            } else {
                this._fakeEventEmitter.emit("play")
                this.play(false)
            }
        }
    }

    _smpFakePause() {
        const mi = this._smpPlayerInterface.currentItem;
        if (mi && mi.fake) {
            this._fakeEventEmitter.emit("pause")
            this._smpPlayerInterface.dispatchEvent({
                type: "pause",
                fake: true
            });
            this.pause(false)
        }
    }

    _smpFakeLoad() {
        // Event called after the first playRequested event is sent. This is the
        // only valid place to dispatch the pause event to get the play/pause
        // button to change
        if(!this._playing) {
            this._smpPlayerInterface.dispatchEvent({
                type: "pause",
                fake: true
            });
        }
    }

    setNonAVPlayoutTime(rendererId, time) {
        if(
            rendererId === this._fakeItemRendererId &&
            this._fakeItemDuration > 0
        ) {
            this._smpPlayerInterface.dispatchEvent({
                type: "timeupdate",
                override: true,
                time,
                duration: this._fakeItemDuration
            })
        }
    }

    startNonAVPlayout(rendererId, duration = 0) {
        super.startNonAVPlayout();
        this._fakeItemRendererId = rendererId
        this._fakeItemDuration = duration
        this._fakeItemLoaded = false;

        const playlist = {
            id: `${uuid()}`,
            items: [{
                fake: true,
                vpid: `fakeitem`,
                duration: this._fakeItemDuration,
            }]
        }

        const config = {
            // XXX ondemandwebcast data probably needed later, for now
            // switching it off
            ondemandWebcastData:false,
            webcastData: {},
            autoplay: true
        }
        logger.info(`SMP-SP loadPlaylist (Fake)`)
        this._smpPlayerInterface.loadPlaylist(playlist, config);

        // Turn off SMP loading wheel
        this._smpPlayerInterface.updateUiConfig({
            buffer: {
                enabled: false
            }
        })

        this._smpPlayerInterface.addEventListener("playRequested", this._smpFakePlay);
        this._smpPlayerInterface.addEventListener("pauseRequested", this._smpFakePause);
        this._smpPlayerInterface.addEventListener("mediaItemInfoChanged", this._smpFakeLoad)
    }

    stopNonAVPlayout(rendererId: ?string) {
        super.stopNonAVPlayout();
        // If stop comes after another nonav renderer has started, ignore
        if(rendererId === this._fakeItemRendererId) {
            this._fakeItemRendererId = null;
            this._fakeItemDuration = -1;
            this._smpPlayerInterface.removeEventListener("playRequested", this._smpFakePlay);
            this._smpPlayerInterface.removeEventListener("pauseRequested", this._smpFakePause);
            this._smpPlayerInterface.removeEventListener("mediaItemInfoChanged", this._smpFakeLoad)

            // Restore SMP loading wheel
            this._smpPlayerInterface.updateUiConfig({
                buffer: {
                    enabled: true
                }
            })
        }
    }

    setPlayoutInactive(rendererId: string) {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.setPlayoutInactive(rendererId)
        }

        // We may need this renderer again so preload
        this._smpPlayerInterface.preloadFromCollection(rendererId)

        if(this._media[rendererId].media.type === MEDIA_TYPES.FOREGROUND_A) {
            this._player.mediaTarget.classList.remove('romper-audio-element');
        }

        return super.setPlayoutInactive(rendererId)
    }

    removeBackgrounds(rendererId: string) {
        this._secondaryPlayoutEngine.removeBackgrounds(rendererId);
    }

    play(changeSMP = true) {
        this._playing = true;
        this._hasStarted = true;
        this.playBackgrounds();
        if(changeSMP) {
            this._smpPlayerInterface.play();
        }
        super.play()
    }

    /**
     * Pauses the player and backgrounds
     * @param {boolean} changeSMP do we change the SMP player state or not
     */
    pause(changeSMP: boolean = true) {
        this._playing = false;
        this.pauseBackgrounds();
        if(changeSMP) {
            this._smpPlayerInterface.pause();
        }
        super.pause()
    }

    isPlaying(): boolean {
        return this._playing;
    }

    hasStarted(): boolean {
        return super.hasStarted()
    }

    pauseBackgrounds() {
        this._secondaryPlayoutEngine.pauseBackgrounds();
    }

    playBackgrounds() {
        this._secondaryPlayoutEngine.playBackgrounds();
    }

    getCurrentTime(rendererId: string) {
        // TODO: May not account for in/out points
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.getCurrentTime(rendererId)
        }
        if(rendererPlayoutObj.active) {
            return this._smpPlayerInterface.currentTime;
        }
        return undefined;

    }

    getDuration(rendererId: string) {
        // TODO: May not account for in/out points
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.getDuration(rendererId)
        }
        if(rendererPlayoutObj.active) {
            return this._smpPlayerInterface.duration
        }
        logger.warn("Cannot get duration of non active")
        return 0
    }

    setCurrentTime(rendererId: string, time: number) {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.setCurrentTime(rendererId, time)
        }
        if(rendererPlayoutObj.active) {
            this._smpPlayerInterface.currentTime = time;
            return true
        }
        logger.warn("Cannot set duration of non active")
        return false;
    }


    on(rendererId: string, event: string, callback: Function) {
        if(event === "play" || event === "pause") {
            this._fakeEventEmitter.addListener(event, callback)
            return false
        }
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.on(rendererId, event, callback)
        }
        if (rendererPlayoutObj.active) {
            // This renderer is using the on screen video element
            // so add event listener directly
            this._smpPlayerInterface.addEventListener(event, callback);
        } else {
            // This renderer is not using the on screen video element
            // so add event listener to the queue so it can be applied in
            // setPlayoutActive
            if (!rendererPlayoutObj.queuedEvents) {
                rendererPlayoutObj.queuedEvents = []
            }
            rendererPlayoutObj.queuedEvents.push({
                event,
                callback,
            })
        }
        return false
    }

    off(rendererId: string, event: string, callback: Function) {
        if(event === "play" || event === "pause") {
            this._fakeEventEmitter.removeListener(event, callback)
            return false
        }
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.off(rendererId, event, callback)
        }
        if (rendererPlayoutObj.active) {
            this._smpPlayerInterface.removeEventListener(event, callback);
        } else if (rendererPlayoutObj.queuedEvents) {
            // This renderer is not using the on screen video element
            // so remove event listener from queue
            const index = rendererPlayoutObj.queuedEvents
                .findIndex((qe) => qe.event === event && qe.callback === callback)
            if (index !== -1) {
                rendererPlayoutObj.queuedEvents.splice(index, 1);
            }
        }
        return false
    }

    // eslint-disable-next-line no-unused-vars
    _getMediaElement(rendererId: string): ?HTMLMediaElement {
        return this._smpPlayerInterface.requestVideoElement(true);
    }

    setLoopAttribute(rendererId: string, loop: ?boolean) {
        const mediaObject = this._media[rendererId];
        if (mediaObject) {
            if (loop) {
                mediaObject.loop = true;
            }
            else {
                mediaObject.loop = false;
            }
        } else {
            this._secondaryPlayoutEngine.setLoopAttribute(rendererId, loop);
        }
    }

    checkIsLooping(rendererId: string) {
        if (this._media[rendererId] && 'loop' in this._media[rendererId]) {
            return this._media[rendererId].loop;
        }
        return false
    }

    applyStyle(rendererId: string, key: string, value: string) {
        const mediaElement = this._smpPlayerInterface.requestVideoElement(true);
        if (mediaElement) {
            mediaElement.style[key] = value;
        }
    }

    clearStyle(rendererId: string, key: string) {
        const mediaElement = this._smpPlayerInterface.requestVideoElement(true);
        if (mediaElement) {
            mediaElement.style[key] = '';
        }
    }

    // TODO: Background Audio Renderer fades in to volume 1
    // So both the mix and overall volume control is ignored when background
    // audio starts playing
    setVolume(rendererId: string, volume: number) {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            this._secondaryPlayoutEngine.setVolume(rendererId, volume)
            return
        }
        if(rendererPlayoutObj.active) {
            this._smpPlayerInterface.volume = volume
        }
    }

    getVolume(rendererId: string, volume: number) {
        const rendererPlayoutObj = this._media[rendererId];
        if(!rendererPlayoutObj) {
            return this._secondaryPlayoutEngine.getVolume(rendererId)
        }
        if(rendererPlayoutObj.active) {
            return this._volume;
        }
        return 1
    }
}

export default SMPPlayoutEngine;
