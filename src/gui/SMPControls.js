// @flow
import BaseControls from './BaseControls';
import Overlay from './Overlay';
import { ButtonEvents } from './Buttons';
import { getSMPInterface } from '../utils'
import { createElementWithClass } from '../documentUtils';
import BasePlayoutEngine from '../playoutEngines/BasePlayoutEngine';
import logger from '../logger';
import AnalyticEvents from '../AnalyticEvents';

/* eslint-disable class-methods-use-this */

const SHOW_CHAPTER_BUTTON = false

class SMPControls extends BaseControls {

    _logUserInteraction: Function;

    _smpPlayerInterface: Object;

    _backButton: boolean;

    _nextButton: boolean;

    _controlsEnabled: boolean;

    _containerDiv: HTMLDivElement;

    _chapterButton: HTMLButtonElement;

    _volumeButton: HTMLButtonElement;

    _volumeControls: HTMLDivElement;

    _masterValueLabel: HTMLSpanElement;

    _uiUpdateQueue: Array<Object>;

    _uiUpdateQueueTimer: Number;

    _scrubTimePoller: ?IntervalID;

    _playoutEngine: BasePlayoutEngine;

    oldCloseVol: Function;

    oldOpenVol: Function;

    _useExternalTransport: boolean;

    constructor(
        logUserInteraction: Function,
        volumeOverlay: Overlay,
        chapterOverlay: Overlay,
        switchableOverlay: Overlay,
        playoutEngine: BasePlayoutEngine,
        useExternalTransport: function,
    ) {
        super(logUserInteraction, volumeOverlay, chapterOverlay, switchableOverlay);

        this._playoutEngine = playoutEngine;

        this._smpPlayerInterface = getSMPInterface();

        this._useExternalTransport = useExternalTransport;

        // Previous Button
        this._smpPlayerInterface.addEventListener("previousRequested", () => {
            this.emit(ButtonEvents.BACK_BUTTON_CLICKED);
        })

        // Next Button
        this._smpPlayerInterface.addEventListener("nextRequested", () => {
            this.emit(ButtonEvents.NEXT_BUTTON_CLICKED)
        })

        this._setupAnalytics();

        // Controls enabled by default
        this._controlsEnabled = (true && !this._useExternalTransport())

        this._containerDiv = createElementWithClass(
            'div',
            'romper-smp-buttons',
            ['romper-buttons-smp', 'notInteractiveContent', 'show'],
        );        

        if(SHOW_CHAPTER_BUTTON) {
            // Setup Chapter Overlay and attach Custom SMP button to it
            this._containerDiv.appendChild(chapterOverlay.getOverlay());
            this._createChapterButton()
            chapterOverlay.useCustomButton(this._chapterButton)
        }

        this._uiUpdateQueue = []

        this._overrideVolumeButton();
        this._createVolumeOverlay()

        this._setDefaultSMPControlsConfig()

    }

    /**
     * Sets up the analytics logging so we listen to what the SMP
     * controls are doing and report to our system.
     *
     * Currently lacks RendererActions:
     *  - VIDEO_PAUSE and VIDEO_UNPAUSE
     *  - BUTTONS_ACTIVATED and BUTTONS_DEACTIVATED
     */
    _setupAnalytics() {
        /* eslint-disable max-len */
        this._smpPlayerInterface.addEventListener("SonarUserActionEvent", (e) => {
            switch(e.controlId) {
            case('back_interval_button'): {
                let seekBackFrom = 'not_set';
                let seekBackTo = 'not_set';
                if (e.labels) {
                    const { beforeTime, afterTime } = e.labels;
                    if (beforeTime !== undefined) { seekBackFrom = beforeTime }
                    if (afterTime !== undefined) { seekBackTo = afterTime }
                }
                this._logUserInteraction(
                    AnalyticEvents.names.SEEK_BACKWARD_BUTTON_CLICKED,
                    `${seekBackFrom}`,
                    `${seekBackTo}`,
                );
                break;
            }
            case('forward_interval_button'): {
                let seekFrom = 'not_set';
                let seekTo = 'not_set';
                if (e.labels) {
                    const { beforeTime, afterTime } = e.labels;
                    if (beforeTime !== undefined) { seekFrom = beforeTime }
                    if (afterTime !== undefined) { seekTo = afterTime }
                }
                this._logUserInteraction(
                    AnalyticEvents.names.SEEK_FORWARD_BUTTON_CLICKED,
                    `${seekFrom}`,
                    `${seekTo}`,
                );
                break;
            }
            case('seek_bar'): {
                let scrubFrom = 'not_set';
                let scrubTo = 'not_set';
                if (e.labels) {
                    /* eslint-disable camelcase */
                    const { before_seek_time, seek_time } = e.labels;
                    if (before_seek_time !== undefined) { scrubFrom = before_seek_time }
                    if (seek_time !== undefined) { scrubTo = seek_time }
                    /* eslint-enable camelcase */
                }
                this._logUserInteraction(
                    AnalyticEvents.names.VIDEO_SCRUBBED,
                    `${scrubFrom}`,
                    `${scrubTo}`,
                );
                break;
            }
            case('pause'):
                this._logUserInteraction(AnalyticEvents.names.PLAY_PAUSE_BUTTON_CLICKED, 'play' , 'pause');
                break;
            case('play'):
                this._logUserInteraction(AnalyticEvents.names.PLAY_PAUSE_BUTTON_CLICKED, 'pause', 'play');
                break;
            case('mute'):
                this._logUserInteraction(AnalyticEvents.names.VOLUME_MUTE_TOGGLED, 'not_set', 'default: true');
                this._handleMuteClick(true);
                break;
            case('unmute'):
                this._logUserInteraction(AnalyticEvents.names.VOLUME_MUTE_TOGGLED, 'not_set', 'default: false');
                this._handleMuteClick(false);
                break;
            case('volume_slider'):
                this._logUserInteraction(AnalyticEvents.names.VOLUME_CHANGED, '', `default: ${e.labels.volume}`);
                break;
            case('enter_picture_in_picture_mode'):
                this._logUserInteraction(AnalyticEvents.names.PIP_MODE_CHANGED, 'normal', 'pip');
                break;
            case('exit_picture_in_picture_mode'):
                this._logUserInteraction(AnalyticEvents.names.PIP_MODE_CHANGED, 'pip', 'normal');
                break;
            case('enter_full_screen'):
                this._logUserInteraction(AnalyticEvents.names.FULLSCREEN_BUTTON_CLICKED, 'not-fullscreen', 'fullscreen');
                break;
            case('exit_full_screen'):
                this._logUserInteraction(AnalyticEvents.names.FULLSCREEN_BUTTON_CLICKED, 'fullscreen', 'not-fullscreen');
                break;
            case('previous_button'):
                this._logUserInteraction(AnalyticEvents.names.BACK_BUTTON_CLICKED);
                break;
            case('next_button'):
                this._logUserInteraction(AnalyticEvents.names.NEXT_BUTTON_CLICKED);
                break;
            case('subtitles_on'):
                this._logUserInteraction(AnalyticEvents.names.SUBTITLES_BUTTON_CLICKED, 'off', 'on');
                break;
            case('subtitles_off'):
                this._logUserInteraction(AnalyticEvents.names.SUBTITLES_BUTTON_CLICKED, 'on', 'off');
                break;
            default:
                break;
            }
        })
        /* eslint-enable max-len */
    }

    _uiUpdate(controlsConfig) {
        this._uiUpdateQueue.push(controlsConfig)
        this._processUiUpdateQueue()
    }

    _processUiUpdateQueue() {
        if(this._uiUpdateQueueTimer) {
            clearTimeout(this._uiUpdateQueueTimer)
            this._uiUpdateQueueTimer = null;
        }
        if(this._smpPlayerInterface.playlist === null) {
            this._uiUpdateQueueTimer = setTimeout(() => {this._processUiUpdateQueue()}, 1000)
            return
        }

        // Apply all UI config changes in one go by combining settings
        const controlsConfig = this._uiUpdateQueue.reduce((combinedConfig, nextValue) => {
            return {
                ...combinedConfig,
                ...nextValue,
            }
        }, {})
        this._uiUpdateQueue = []

        this._smpPlayerInterface.updateUiConfig({
            controls: controlsConfig,
        });
    }

    _setDefaultSMPControlsConfig() {
        // Setup Default Controls Settings
        this._smpPlayerInterface.updateUiConfig({
            pictureInPicture : { enabled: false },
            allowAudioControlsToHide: true,
            chromecast: { enabled: false },
            controls: {
                volumeDismissTime: 5000,
                enabled: !this._useExternalTransport(),
                spaceControlsPlayback: true,
                availableOnMediaEnded: true,
                includeNextButton: true,
                includePreviousButton: true,
                alwaysEnablePreviousButton: false,
                alwaysEnableNextButton: false,
            },
        });
    }

    _createVolumeOverlay() {
        const smpVolumeBox = createElementWithClass('div', 'smp-volume-overlay',
            ['smp-volume', 'romper-inactive']);
        this._volumeControls = smpVolumeBox;

        const mixContainer = this._createMixControl();
        smpVolumeBox.appendChild(mixContainer);

        const masterContainer = this._createMasterVolumeControl();
        smpVolumeBox.appendChild(masterContainer);

        // this currently isn't really visible
        const triangle = createElementWithClass('div', null, ['triangle']);
        smpVolumeBox.appendChild(triangle);

        // eslint-disable-next-line no-undef
        publicApi.ui.volumeControl.volumeControls.appendChild(smpVolumeBox);

    }

    // create slider for controlling mix
    _createMixControl(): HTMLDivElement {
        const mixContainer = createElementWithClass('div', 'audio-mix-box',
            ['audio-volume-box', 'romper-disabled']);

        const fbMixSliderLabel = createElementWithClass('div', 'audio-mix-label',
            ['audio-slider-label']);
        fbMixSliderLabel.innerHTML = "Disabled";
        mixContainer.appendChild(fbMixSliderLabel);

        const fbMixSlider = createElementWithClass('input', 'audio-mix-slider',
            ['audio-slider']);
        fbMixSlider.type = 'range';
        fbMixSlider.min = 0;
        fbMixSlider.max = 1;
        fbMixSlider.value = '1';
        fbMixSlider.step = 0.1;
        fbMixSlider.addEventListener("change", (e) => {
            const sliderValue = parseFloat(e.target.value)
            this._playoutEngine.setFbMix(sliderValue)
            this._setMixerLabel()
        })

        fbMixSlider.addEventListener("input", (e) => {
            const sliderValue = parseFloat(e.target.value)
            this._playoutEngine.setFbMix(sliderValue)
        })
        
        mixContainer.appendChild(fbMixSlider);
        return mixContainer;
    }

    _setMixerLabel() {
        const slider = document.getElementById('audio-mix-slider');
        const sliderValue = slider.value;
        const label = document.getElementById('audio-mix-label')
        if(sliderValue <= 0.5) {
            label.innerHTML = "Accessible Mix"
        } else if(sliderValue > 0.5 && sliderValue < 0.75) {
            label.innerHTML = "Enhanced Mix"
        } else if(sliderValue >= 0.75) {
            label.innerHTML = "Default Mix"
        } else {
            logger.warn("Invalid mix slider value: ")
        }
    }

    // create slider for main volume control
    _createMasterVolumeControl(): HTMLDivElement {
        const masterContainer = createElementWithClass('div',
            'audio-master-box', ['audio-volume-box']);

        const masterSliderLabel = createElementWithClass('div',
            'audio-master-label', ['audio-slider-label']);
        masterSliderLabel.innerHTML = "Master Volume"
        masterContainer.appendChild(masterSliderLabel)

        const masterSlider = createElementWithClass('input',
            'audio-master-slider', ['audio-slider'])
        masterSlider.type = 'range';
        masterSlider.min = 0;
        masterSlider.max = 11;
        masterSlider.value = this._smpPlayerInterface.volume ?
            `${this._smpPlayerInterface.volume * 11}` : '5';
        masterSlider.step = 1;

        const changeVol = (e) => {
            const sliderValue = parseFloat(e.target.value);
            this._smpPlayerInterface.volume = sliderValue / 11;
            this._masterValueLabel.textContent = `${Math.round(sliderValue)}`;
        };
        masterSlider.addEventListener("change", changeVol);
        masterSlider.addEventListener("input", changeVol);
        
        masterContainer.appendChild(masterSlider);

        const volLabel = createElementWithClass('div',
            'master-volume-value', ['volume-label']);
        this._masterValueLabel = document.createElement('span');
        this._masterValueLabel.textContent = this._smpPlayerInterface.volume ?
            `${Math.round(this._smpPlayerInterface.volume * 10)}` : '7';
        volLabel.appendChild(this._masterValueLabel);
        masterContainer.appendChild(volLabel);
        return masterContainer;
    }

    _handleMuteClick(muted) {
        if(muted) {
            this._volumeControls.classList.add('muted');
            this._masterValueLabel.textContent = '0';
        } else {
            this._volumeControls.classList.remove('muted');
            this._masterValueLabel.textContent = `${Math.round(this._smpPlayerInterface.volume * 11)}`;
        }
    }

    _overrideVolumeButton() {
        /* eslint-disable no-undef */
        this.oldOpenVol = publicApi.ui.volumeControl.openVolumeControls;
        this.oldCloseVol = publicApi.ui.volumeControl.closeVolumeControls;
        publicApi.ui.volumeControl.openVolumeControls = () => {
            this._volumeControls.classList.remove('romper-inactive');
        }
        publicApi.ui.volumeControl.closeVolumeControls = () => {
            this._volumeControls.classList.add('romper-inactive');
        };
        publicApi.ui.volumeControl.volumeControls.style.overflow = 'visible'
        /* eslint-enable no-undef */
    }

    _clearVolumeButtonOverride() {
        /* eslint-disable no-undef */
        publicApi.ui.volumeControl.openVolumeControls = this.oldOpenVol;
        publicApi.ui.volumeControl.closeVolumeControls = this.oldCloseVol;
        /* eslint-enable no-undef */
    }

    _createChapterButton() {
        const controlBar = document.querySelector('.mediaContainer');
        const chapterButton = createElementWithClass('button', 'smp-chapter-button',
            ['p_button', 'p_controlBarButton', 'chapter-button', 'romper-inactive']);
        chapterButton.setAttribute("role", "button")
        chapterButton.setAttribute("aria-live", "polite")
        chapterButton.setAttribute("aria-label", "Toggle Chapter Menu")
        chapterButton.onmouseover = () => {
            chapterButton.classList.add("p_buttonHover")
        }
        chapterButton.onmouseout = () => {
            chapterButton.classList.remove("p_buttonHover")
        }
        chapterButton.innerHTML = `
            <span class="p_hiddenElement" aria-hidden="true">Toggle Chapter Menu</span>
            <div class="p_iconHolder">
                <svg xmlns="http://www.w3.org/2000/svg" 
                    class="p_svg chapter-icon" focusable="false" viewBox="0 0 60 60">
                <title>chapters</title>
                <rect x="8" width="24" height="8"/>
                <rect x="16" y="12" width="16" height="8"/>
                <rect x="8" y="24" width="24" height="8"/>
                <polygon points="0 23 12 16 0 9 0 23"/>
            </svg>
        </div>`;
        controlBar.appendChild(chapterButton)

        this._chapterButton = chapterButton;
    }


    /* getters */

    // get the whole lot organised in a DIV
    getControls(): HTMLDivElement {
        return this._containerDiv
    }

    // get a div that activates the buttons
    getActivator(): HTMLDivElement { }

    // are the controls showing
    getShowing(): boolean {
        return true
    }

    /* exposing functionality to change how buttons look/feel */
    disableControls() {
        this._smpPlayerInterface.dispatchEvent({ type: 'PLUGIN_UI', myData: "DISABLE_CONTROLS"});
        if(this._controlsEnabled !== false) {
            this._uiUpdate({
                enabled: false,
            })
            this._controlsEnabled = false
        }
    }

    enableControls() {
        this._smpPlayerInterface.dispatchEvent({ type: 'PLUGIN_UI', myData: "ENABLE_CONTROLS"});
        if(this._controlsEnabled !== true && !this._useExternalTransport()) {
            this._uiUpdate({
                enabled: true,
            })
            this._controlsEnabled = true
        }
    }

    enableBackgroundAudio() {
        const mixer = document.getElementById('audio-mix-box');
        mixer.classList.remove('romper-disabled');
        this._setMixerLabel();
    }

    disableBackgroundAudio() {
        const mixer = document.getElementById('audio-mix-box');
        mixer.classList.add('romper-disabled');
        const label = document.getElementById('audio-mix-label');
        label.textContent = 'Disabled';
    }

    // eslint-disable-next-line class-methods-use-this
    showControls() {
        // Activating of SMP handled by SMP. No need to manually show/hide controls
    }

    // eslint-disable-next-line class-methods-use-this
    hideControls() {
        // Activating of SMP handled by SMP. No need to manually show/hide controls
    }

    setControlsActive() {
        this.enableControls();
    }

    setControlsInactive() {
        // called when restarting an experience and throwing up new splash screen
        // and play button
        // TODO: need to test properly
        this.disableControls();
    }

    setFullscreenOn() { }

    setFullscreenOff() { }

    hideScrubBar() {
        // Not used, might be required for hideSeekButtons in player
    }

    showScrubBar() {
        // Called from showSeekButtons in player
    }

    focusScrubBar() {
        // can't do this
    }

    enableScrubBar() {
        if(this._scrubEnabled !== true) {
            this._uiUpdate({
                mode: "default",
            })
            this._scrubEnabled = true
        }
    }

    disableScrubBar() {
        if(this._scrubEnabled !== false) {
            this._uiUpdate({
                mode: "controls",
            })
            this._scrubEnabled = false
        }
    }

    connectScrubBar(renderer: BaseRenderer) {
        // clear any existing polling
        if (this._scrubTimePoller) clearInterval(this._scrubTimePoller);

        // Update the seek bar as the media plays
        this._scrubTimePoller = setInterval(
            () => {
                const { currentTime } = renderer.getCurrentTime();
                this._playoutEngine.setNonAVPlayoutTime(renderer._rendererId, currentTime);
            },
            200,
        );

        this._smpPlayerInterface.addEventListener("seekRequested", (event) => {
            const { currentTime, duration } = renderer.getCurrentTime();
            let seekTo = event.time;
            // Hack as SMP doesn't have time whilst playing fake item so detect is
            // seek is due to scrub or +/- 20s buttons
            if(seekTo === this._playoutEngine.getCurrentTime(renderer._rendererId) + 20) {
                seekTo = Math.min(currentTime + 20, duration);
            } else if(seekTo === 0 
                && this._playoutEngine.getCurrentTime(renderer._rendererId) <= 20) {
                seekTo = Math.max(currentTime - 20, 0);
            }
            renderer.setCurrentTime(seekTo);
        })
    }

    disconnectScrubBar() {
        // clear any existing polling
        if (this._scrubTimePoller) clearInterval(this._scrubTimePoller);
    }

    setTransportControlsActive() { }

    setTransportControlsInactive() { }

    showSeekButtons() {
        // TODO: Where is hideSeekButtons?!
    }

    enablePlayButton() {
        // Hack: SMP may change element id at anytime which is why it's in a
        // catch statement
        try {
            document.getElementById("p_audioui_playpause").removeAttribute('disabled');
        } catch (error) {
            logger.warn("Cannot find play button: ", error)
        }
    }

    disablePlayButton() {
        // Hack: SMP may change element id at anytime which is why it's in a
        // catch statement
        try {
            document.getElementById("p_audioui_playpause").setAttribute('disabled', 'true');
        } catch (error) {
            logger.warn("Cannot find play button: ", error)
        }
    }

    setPlaying(){ }

    setNextAvailable(isNextAvailable: boolean) {
        if(this._nextEnabled !== isNextAvailable) {
            this._uiUpdate({
                alwaysEnableNextButton: isNextAvailable,
            })
            this._nextEnabled = isNextAvailable
        }

    }

    setBackAvailable(isBackAvailable: boolean) {
        if(this._backButton !== isBackAvailable) {
            this._uiUpdate({
                alwaysEnablePreviousButton: isBackAvailable,
            })
            this._backButton = isBackAvailable;
        }
    }

    // eslint-disable-next-line class-methods-use-this
    enableSubtitlesButton() {
        // SMP Handles Subtitles & Subtitles Button
    }

    // eslint-disable-next-line class-methods-use-this
    disableSubtitlesButton() {
        // SMP Handles Subtitles & Subtitles Button
    }

    // choices are showing on screen - shift the subtitles up
    setSubtitlesAboveElement(behaviourElement) { 
        const choiceHeight = behaviourElement.offsetHeight;
        const playerHeight =  this._playoutEngine._smpPlayerInterface.container.offsetHeight;
        const maxSubsY = playerHeight - choiceHeight;
        getSMPInterface().updateUiConfig({
            subtitles: {
                yOffset: maxSubsY,
            }
        });
    }


    setAccessilitySliderAvailable(show) {
        if (show) {
            this._overrideVolumeButton()
        } else {
            this._clearVolumeButtonOverride();
        }
    }

    // choices have been cleared - return the subtitles to normal
    resetSubtitleHeight() {
        getSMPInterface().updateUiConfig({
            subtitles: { yOffset:  NaN },
        });
    }
}

export default SMPControls;
