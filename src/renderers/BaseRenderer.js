// @flow
/* eslint-disable class-methods-use-this */
import EventEmitter from 'events';
import BehaviourRunner from '../behaviours/BehaviourRunner';
import BehaviourTimings from '../behaviours/BehaviourTimings';
import PauseBehaviour from '../behaviours/PauseBehaviour';
import VariableManipulateBehaviour from '../behaviours/VariableManipulateBehaviour';
import RendererEvents from './RendererEvents';
import type { Representation, AssetCollectionFetcher, MediaFetcher } from '../storyplayer';
import Player, { PlayerEvents } from '../gui/Player';
import PlayoutEngine from '../playoutEngines/BasePlayoutEngine';
import AnalyticEvents from '../AnalyticEvents';
import type { AnalyticsLogger, AnalyticEventName } from '../AnalyticEvents';
import Controller from '../Controller';
import logger from '../logger';
import { VARIABLE_EVENTS } from '../Events';
import { buildPanel } from '../behaviours/VariablePanelHelper';

import { renderSocialPopup } from '../behaviours/SocialShareBehaviourHelper';
import { renderLinkoutPopup } from '../behaviours/LinkOutBehaviourHelper';
import { renderTextOverlay } from '../behaviours/TextOverlayBehaviourHelper';
import { renderMapOverlay } from '../behaviours/MapLinkBehaviourHelper';
import Overlay from '../gui/Overlay';

const SEEK_TIME = 10;
// TODO: Consider making this longer now it runs higher than 4Hz.
const TIMER_INTERVAL = 10;


const getBehaviourEndTime = (behaviour: Object) => {
    if(behaviour.duration !== undefined) {
        const endTime = behaviour.start_time + behaviour.duration;
        return endTime;
    }
    return undefined;
}

export const RENDERER_PHASES = {
    CONSTRUCTING: 'CONSTRUCTING',
    CONSTRUCTED: 'CONSTRUCTED',
    MAIN: 'MAIN',
    COMPLETING: 'COMPLETING',
    ENDED: 'ENDED',
    DESTROYED: 'DESTROYED',
    BG_FADE_IN: 'BG_FADE_IN',
    BG_FADE_OUT: 'BG_FADE_OUT',
    MEDIA_FINISHED: 'MEDIA_FINISHED', // done all its rendering and ready to move on, but not ended
};

export default class BaseRenderer extends EventEmitter {
    _rendererId: string;

    _representation: Representation;

    _fetchAssetCollection: AssetCollectionFetcher;

    _fetchMedia: MediaFetcher;

    _player: Player;

    _playoutEngine: PlayoutEngine;

    _behaviourRunner: ?BehaviourRunner;

    _behaviourRendererMap: { [key: string]: (behaviour: Object, callback: () => mixed) => void };

    _applyColourOverlayBehaviour: Function;

    _applyShowImageBehaviour: Function;

    _applyShowVariablePanelBehaviour: Function;

    _applyShowChoiceBehaviour: Function;

    _renderLinkChoices: Function;

    _applySocialSharePanelBehaviour: Function;

    _applyLinkOutBehaviour: Function;

    _handleLinkChoiceEvent: Function;

    _seekForward: Function;

    _seekBack: Function;

    _behaviourElements: Array<HTMLElement>;

    _target: HTMLDivElement;

    _destroyed: boolean;

    _analytics: AnalyticsLogger;

    _controller: Controller;

    _preloadedBehaviourAssets: Array<Image>;

    _preloadedIconAssets: Array<Image>;

    _choiceBehaviourData: Object;

    _linkBehaviour: Object;

    inVariablePanel: boolean;

    _linkFadeTimeout: TimeoutID;

    _willHideControls: Function;

    _hideControls: Function;

    _showControls: Function;

    _setBehaviourElementAttribute: Function;

    _linkChoiceBehaviourOverlay: Overlay;

    _cleanupSingleDuringBehaviour: Function;

    _runSingleDuringBehaviour: Function;

    _runDuringBehaviours: Function;

    addTimeEventListener: Function;

    _handlePlayPauseButtonClicked: Function;

    _duration: ?number;

    _inPauseBehaviourState: boolean;

    phase: string;

    /**
     * Load an particular representation. This should not actually render anything until start()
     * is called, as this could be constructed in advance as part of pre-loading.
     *
     * @param {Representation} representation the representation node to be rendered
     * @param {AssetCollectionFetcher} assetCollectionFetcher a fetcher for asset collections
     * @param {MediaFetcher} MediaFetcher a fetcher for media
     * @param {Player} player the Player used to manage DOM changes
     *
     */
    constructor(
        representation: Representation,
        assetCollectionFetcher: AssetCollectionFetcher,
        mediaFetcher: MediaFetcher,
        player: Player,
        analytics: AnalyticsLogger,
        controller: Controller,
    ) {
        super();

        this._representation = representation;
        this._rendererId = this._representation.id;
        this._fetchAssetCollection = assetCollectionFetcher;
        this._fetchMedia = mediaFetcher;
        this._player = player;
        this._playoutEngine = player.playoutEngine;
        this._target = player.mediaTarget;
        this._controller = controller;

        this._applyColourOverlayBehaviour = this._applyColourOverlayBehaviour.bind(this);
        this._applyShowImageBehaviour = this._applyShowImageBehaviour.bind(this);
        this._applyShowVariablePanelBehaviour = this._applyShowVariablePanelBehaviour.bind(this);
        this._applyShowChoiceBehaviour = this._applyShowChoiceBehaviour.bind(this);
        this._renderLinkChoices = this._renderLinkChoices.bind(this);
        this._handleLinkChoiceEvent = this._handleLinkChoiceEvent.bind(this);
        this._applySocialSharePanelBehaviour = this._applySocialSharePanelBehaviour.bind(this);
        this._applyLinkOutBehaviour = this._applyLinkOutBehaviour.bind(this);
        this._applyTextOverlayBehaviour = this._applyTextOverlayBehaviour.bind(this);
        this._applyMapOverlayBehaviour = this._applyMapOverlayBehaviour.bind(this);
        this._applyFadeInBehaviour = this._applyFadeInBehaviour.bind(this);
        this._applyFadeOutBehaviour = this._applyFadeOutBehaviour.bind(this);
        this._applyFadeAudioOutBehaviour = this._applyFadeAudioOutBehaviour.bind(this);
        this._applyFadeAudioInBehaviour = this._applyFadeAudioInBehaviour.bind(this);
        this._seekBack = this._seekBack.bind(this);
        this._seekForward = this._seekForward.bind(this);
        this._handlePlayPauseButtonClicked = this._handlePlayPauseButtonClicked.bind(this);
        this._setBehaviourElementAttribute = this._setBehaviourElementAttribute.bind(this);

        this._willHideControls = this._willHideControls.bind(this);
        this._hideControls = this._hideControls.bind(this);
        this._showControls = this._showControls.bind(this);
        this._runDuringBehaviours = this._runDuringBehaviours.bind(this);
        this._runSingleDuringBehaviour = this._runSingleDuringBehaviour.bind(this);
        this.addTimeEventListener = this.addTimeEventListener.bind(this);

        this._behaviourRendererMap = {
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:colouroverlay/v1.0': this._applyColourOverlayBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:showimage/v1.0': this._applyShowImageBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:showvariablepanel/v1.0': this._applyShowVariablePanelBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:showlinkchoices/v1.0': this._applyShowChoiceBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:socialmodal/v1.0': this._applySocialSharePanelBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:linkoutmodal/v1.0' : this._applyLinkOutBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:textoverlay/v1.0' : this._applyTextOverlayBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:mapoverlay/v1.0' : this._applyMapOverlayBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:fadein/v1.0' : this._applyFadeInBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:fadeout/v1.0' : this._applyFadeOutBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:fadeaudioout/v1.0' : this._applyFadeAudioOutBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:fadeaudioin/v1.0' : this._applyFadeAudioInBehaviour,
        };

        this._behaviourClassMap = {
            // behaviours which are handled outside the renderer
            'urn:x-object-based-media:representation-behaviour:pause/v1.0': PauseBehaviour,
            // eslint-disable-next-line max-len
            'urn:x-object-based-media:representation-behaviour:manipulatevariable/v1.0': VariableManipulateBehaviour,
        }

        this._behaviourElements = [];
        this._destroyed = false;
        this._analytics = analytics;
        this.inVariablePanel = false;
        this._preloadedBehaviourAssets = [];
        this._preloadIconAssets().catch(e =>
            logger.warn(e, 'Could not preload icon assets'));
        this._setPhase(RENDERER_PHASES.CONSTRUCTING);
        this._inPauseBehaviourState = false;

        this._serviceTimedEvents = this._serviceTimedEvents.bind(this);
        this._timedEvents = {};
    }

    _serviceTimedEvents() {
        Object.keys(this._timedEvents).forEach((timeEventId) => {
            const {
                startTime,
                startCallback,
                isRunning,
                endTime,
                clearCallback,
            } = this._timedEvents[timeEventId];

            const { currentTime }  = this.getCurrentTime();

            if (!this._player.userInteractionStarted()) return;

            // handle starting event
            if (currentTime >= startTime && currentTime <= endTime && !isRunning){
                logger.info(`TimeManager: ${this._rendererId} timer running timed event ${timeEventId}`);
                this._timedEvents[timeEventId].isRunning = true;
                startCallback();
            }

            // handle clearing event
            if ((currentTime < startTime || currentTime > endTime) && isRunning) {
                try {
                    if (clearCallback) clearCallback();
                } catch (err) {
                    logger.warn(`TimeManager: ${this._rendererId} couldn't clear up behaviour ${timeEventId}`);
                }
                this._timedEvents[timeEventId].isRunning = false;
            }
        });
    }

    addTimeEventListener(
        listenerId: string,
        startTime: number,
        startCallback: Function,
        endTime: ?number = Infinity,
        clearCallback: ?Function,
    ) {
        logger.debug(`timer: Added event for ${listenerId} at ${startTime}`);
        this._timedEvents[listenerId] = {
            startTime,
            endTime,
            startCallback,
            isRunning: false,
            clearCallback,
        };
    }

    deleteTimeEventListener(listenerId: string) {
        if (listenerId in this._timedEvents) {
            delete this._timedEvents[listenerId];
        }
    }

    // run any code that may be asynchronous
    async init() {
        // eslint-disable-next-line max-len
        throw new Error('Need to override this class to run async code and set renderer phase to CONSTRUCTED');
    }


    /**
     * When start() is called you are expected to take control of the DOM node in question.
     *
     * @fires BaseRenderer#complete
     * @return {void}
     */

    start() {
        if (this.phase === RENDERER_PHASES.CONSTRUCTING) {
            setTimeout(() => this.start(), 100);
            return false;
        }

        // init the behaviour runner, which will run completed behaviours
        this._behaviourRunner = this._representation.behaviours ?
            new BehaviourRunner(this._representation.behaviours, this) :
            null;
        
        this.emit(RendererEvents.CONSTRUCTED);

        this._player.setCurrentRenderer(this);
        this._player.on(PlayerEvents.SEEK_BACKWARD_BUTTON_CLICKED, this._seekBack);
        this._player.on(PlayerEvents.SEEK_FORWARD_BUTTON_CLICKED, this._seekForward);
        this._setPhase(RENDERER_PHASES.MAIN);
        this._showControls();

        this._runDuringBehaviours(); // queue up all during events
        this._serviceTimedEvents(); // run any that should start at 0

        clearInterval(this._timedEventsInterval);
        this._timedEventsInterval = setInterval(this._serviceTimedEvents, TIMER_INTERVAL);
        this.emit(RendererEvents.STARTED);
        this._player.connectScrubBar(this);
        this._player.on(PlayerEvents.PLAY_PAUSE_BUTTON_CLICKED, this._handlePlayPauseButtonClicked);
        this._player.hideSeekButtons();
        return true;
    }

    end(): boolean {
        // WONT FIX: End is called even if a renderer hasn't been started
        // this will likely result in issues but we've not encountered any
        // and fixing will cause more issues so it's being left as it is
        switch (this.phase) {
        case (RENDERER_PHASES.ENDED):
        case (RENDERER_PHASES.DESTROYED):
            // eslint-disable-next-line max-len
            logger.debug('PHASE base ended already', this._representation.id, this.phase);
            return false;
        default:
            break;
        };
        logger.debug('PHASE base ending', this._representation.id, this.phase);
        this._player.disconnectScrubBar(this);
        try{
            this._clearBehaviourElements()
        } catch (e) {
            logger.warn(e, 'error clearing behaviour elements');
        }
        clearInterval(this._timedEventsInterval);
        this._reapplyLinkConditions();
        this._player.exitCompleteBehaviourPhase();
        this._player.removeListener(PlayerEvents.LINK_CHOSEN, this._handleLinkChoiceEvent);
        this._player.removeListener(PlayerEvents.SEEK_BACKWARD_BUTTON_CLICKED, this._seekBack);
        this._player.removeListener(PlayerEvents.SEEK_FORWARD_BUTTON_CLICKED, this._seekForward);
        this._controller.off(VARIABLE_EVENTS.CONTROLLER_CHANGED_VARIABLE, this._renderLinkChoices);
        this._player.removeListener(
            PlayerEvents.PLAY_PAUSE_BUTTON_CLICKED,
            this._handlePlayPauseButtonClicked,
        );
        this._setPhase(RENDERER_PHASES.ENDED);
        return true;
    }

    // has the media finished?
    hasMediaEnded(): boolean {
        return (
            this.phase === RENDERER_PHASES.MEDIA_FINISHED
            || this.phase === RENDERER_PHASES.COMPLETING
            || this.phase === RENDERER_PHASES.ENDED
            || this.phase === RENDERER_PHASES.DESTROYED
        );
    }

    exitCompletePauseBehaviour() {
        if (!this._behaviourRunner || this._behaviourRunner.eventCounters.completed === 0 ) return;
        const endBehaviours = this._behaviourRunner.behaviours;
        endBehaviours.forEach((behaviour => {
            if (behaviour instanceof PauseBehaviour) {
                behaviour.handleTimeout();
            }
        }));
    }

    // does this renderer have a show variable panel behaviour
    hasVariablePanelBehaviour(): boolean {
        let hasPanel = false;
        if (this._representation.behaviours && this._representation.behaviours.completed) {
            this._representation.behaviours.completed.forEach((behave) => {
                // eslint-disable-next-line max-len
                if (behave.type === 'urn:x-object-based-media:representation-behaviour:showvariablepanel/v1.0') {
                    hasPanel = true;
                }
            });
        }
        return hasPanel;
    }

    /* record some analytics for the renderer - not user actions though */
    logRendererAction(userEventName: AnalyticEventName) {
        const logData = {
            type: AnalyticEvents.types.RENDERER_ACTION,
            name: AnalyticEvents.names[userEventName],
            from: 'not_set',
            to: 'not_set',
        };
        this._analytics(logData);
    }

    /* record some analytics for a user action */
    logUserInteraction(
        userEventName: AnalyticEventName,
        fromId: string = 'not_set',
        toId: string = 'not_set',
    ) {
        const logData = {
            type: AnalyticEvents.types.USER_ACTION,
            name: AnalyticEvents.names[userEventName],
            from: fromId === null ? 'not_set' : fromId,
            to: toId === null ? 'not_set' : toId,
        };
        this._analytics(logData);
    }

    /**
     * get the representation that this renderer is currently rendering
     * @returns {Representation}
     */
    getRepresentation(): Representation {
        return this._representation;
    }

    getDuration(): number {
        let  { duration } = this._representation;
        if (
            duration === undefined ||
            duration === null ||
            duration < 0
        ) {
            duration = Infinity;
        }

        return duration;
    }

    getCurrentTime(): Object {
        throw new Error('getCurrentTime not implemented.');
    }

    // eslint-disable-next-line no-unused-vars
    setCurrentTime(time: number) {
        throw new Error('setCurrentTime not implemented.');
    }

    _handlePlayPauseButtonClicked(eventData): void {
        if ((eventData && eventData.playButtonClicked)){
            this.play();
        } else if((eventData && eventData.pauseButtonClicked)){
            this.pause();
        }

        // if we're in a pause behaviour, kill it
        if (this.getInPause()) {
            this.setInPause(false);
        }

        if (this._playoutEngine.getPlayoutActive(this._rendererId)) {
            if (this._playoutEngine.isPlaying()) {
                this.logRendererAction(AnalyticEvents.names.VIDEO_UNPAUSE);
            } else {
                this.logRendererAction(AnalyticEvents.names.VIDEO_PAUSE);
            }
        }
    }

    pause() {
        this._playoutEngine.pause();
    }

    play() {
        this._playoutEngine.play();
    }

    _seekBack() {
        if (this.phase === RENDERER_PHASES.COMPLETING) {
            logger.info('Seek backward button clicked during behaviours - ignoring'); // eslint-disable-line max-len
            return;
        }
        const { timeBased, currentTime } = this.getCurrentTime();
        if (timeBased) {
            let targetTime = currentTime - SEEK_TIME;
            if (targetTime < 0) {
                targetTime = 0;
            }
            this.logUserInteraction(AnalyticEvents.names.SEEK_BACKWARD_BUTTON_CLICKED,
                currentTime,
                `${targetTime}`,
            );
            this.setCurrentTime(targetTime);
        }
    }

    _seekForward() {
        if (this.phase === RENDERER_PHASES.COMPLETING) {
            logger.info('Seek forward button clicked during infinite end pause - ending element'); // eslint-disable-line max-len
            this.exitCompletePauseBehaviour();
            return;
        }
        const { timeBased, currentTime, duration } = this.getCurrentTime();
        if (timeBased) {
            let targetTime = Math.min(currentTime + SEEK_TIME, duration);
            const choiceTime = this.getChoiceTime();
            if (choiceTime > 0 && choiceTime < targetTime) {
                targetTime = choiceTime;
            }
            this.setCurrentTime(targetTime);
            this.logUserInteraction(AnalyticEvents.names.SEEK_FORWARD_BUTTON_CLICKED,
                currentTime,
                `${targetTime}`,
            );
        }
    }

    // get the time of the first choice in the element
    // returns -1 if no such behaviours
    getChoiceTime(): number {
        if (this._representation.behaviours) {
            if (this._representation.behaviours.during) {
                const matches = this._representation.behaviours.during.filter(behave =>
                    behave.behaviour.type === 'urn:x-object-based-media:representation-behaviour:showlinkchoices/v1.0') // eslint-disable-line max-len
                    .sort((a, b) => a.start_time - b.start_time);
                if (matches.length > 0) {
                    return matches[0].start_time;
                }
            }
        }
        return -1;
    }

    complete() {
        if (this._linkFadeTimeout) {
            // a link has been chosen and is fading out
            // controller will move to next element as soon as done
            // so don't finish this one
            return;
        }
        this._setPhase(RENDERER_PHASES.COMPLETING);
        if (!this._linkBehaviour ||
            (this._linkBehaviour && !this._linkBehaviour.forceChoice)) {
            this._player.enterCompleteBehavourPhase();
            this.emit(RendererEvents.STARTED_COMPLETE_BEHAVIOURS);
            if (!this._behaviourRunner ||
                !this._behaviourRunner.runBehaviours(
                    BehaviourTimings.completed,
                    RendererEvents.COMPLETED,
                )
            ) {
                // we didn't find any behaviours to run, so emit completion event
                this.emit(RendererEvents.COMPLETED);
            }
        }
    }

    switchFrom() {
        this.end();
    }

    // prepare renderer so it can be switched to quickly and in sync
    cueUp() { }

    switchTo() {
        this.start();
    }

    async _preloadBehaviourAssets() {
        this._preloadedBehaviourAssets = [];
        const assetCollectionIds = this._representation.asset_collections.behaviours ?
            this._representation.asset_collections.behaviours : [];

        await Promise.all(assetCollectionIds.map(async (behaviour) => {
            try {
                const assetCollection = await this._fetchAssetCollection(behaviour.asset_collection_id);
                if (assetCollection.assets.image_src) {
                    // eslint-disable-next-line max-len
                    const imageUrl = await this._fetchMedia(assetCollection.assets.image_src, { includeCredentials: true });
                    if (imageUrl) {
                        const image = new Image();
                        image.src = imageUrl;
                        this._preloadedBehaviourAssets.push(image);
                    }
                }
            } catch (err) {
                logger.error(err,
                    `could not preload behaviour asset ${behaviour.asset_collection_id}`);
            }
        }));
    }

    _preloadIconAssets() {
        this._preloadedIconAssets = [];
        const assetCollectionIds = [];
        if (this._representation.asset_collections.icon) {
            if (this._representation.asset_collections.icon.default_id) {
                assetCollectionIds.push(this._representation.asset_collections.icon.default_id);
            }
            if (this._representation.asset_collections.icon.active_id) {
                assetCollectionIds.push(this._representation.asset_collections.icon.active_id);
            }
        }
        return Promise.all(assetCollectionIds.map((iconAssetCollection) => {
            return this._fetchAssetCollection(iconAssetCollection)
                .then((assetCollection) => {
                    if (assetCollection.assets.image_src) {
                        return this._fetchMedia(assetCollection.assets.image_src, { includeCredentials: true });
                    }
                    return Promise.resolve();
                })
                .then((imageUrl) => {
                    if (imageUrl) {
                        const image = new Image();
                        image.src = imageUrl;
                        logger.info(`Preloading icon ${imageUrl}`);
                        this._preloadedIconAssets.push(image);
                    }
                }).catch((err) => {
                    logger.error(err, `could not preload icon asset ${iconAssetCollection}`);
                });
        }));
    }

    getBehaviourRenderer(behaviourUrn: string): (behaviour: Object, callback: () => mixed) => void {
        const behaviourHandler = this._behaviourRendererMap[behaviourUrn];
        if (behaviourHandler) return behaviourHandler;
        const BehaviourHandlerClass = this._behaviourClassMap[behaviourUrn];
        if (BehaviourHandlerClass) {
            return (behaviour, callback) => {
                const runner = new BehaviourHandlerClass(behaviour, callback);
                runner.start(this);
            }
        }
        logger.warn(`Unable to handle behaviour of type ${behaviourUrn}`);
        return null;
    }

    hasShowIconBehaviour(): boolean {
        if (this._representation.behaviours) {
            if (this._representation.behaviours.started) {
                const startMatches = this._representation.behaviours.started.filter(behave =>
                    behave.type === 'urn:x-object-based-media:representation-behaviour:showlinkchoices/v1.0'); // eslint-disable-line max-len
                if (startMatches.length > 0) {
                    return true;
                }
            }
            if (this._representation.behaviours.completed) {
                const endMatches = this._representation.behaviours.completed.filter(behave =>
                    behave.type === 'urn:x-object-based-media:representation-behaviour:showlinkchoices/v1.0'); // eslint-disable-line max-len
                if (endMatches.length > 0) {
                    return true;
                }
            }
            if (this._representation.behaviours.during) {
                const matches = this._representation.behaviours.during.filter(behave =>
                    behave.behaviour.type === 'urn:x-object-based-media:representation-behaviour:showlinkchoices/v1.0'); // eslint-disable-line max-len
                if (matches.length > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    resetPlayer() {
        this._player.resetControls();
        this._player.removeListener(PlayerEvents.LINK_CHOSEN, this._handleLinkChoiceEvent);
    }


    _willHideControls(behaviour: Object) {
        return behaviour.type ===
            'urn:x-object-based-media:representation-behaviour:showlinkchoices/v1.0' // eslint-disable-line max-len
            && behaviour.disable_controls;
    }

    _hideControls(startTime: number) {
        const hideControls = () => {
            this._player.disableControls();
            this._player._hideRomperButtons();
        };
        if (startTime > 1) {
            this.addTimeEventListener(
                'prechoice-control-hide',
                startTime - 0.4,
                hideControls,
            );
        } else {
            hideControls();
        }
    }

    _showControls() {
        if (this._player.userInteractionStarted()) this._player.enableControls();
    }

    _runDuringBehaviours() {
        // run during behaviours (add them to the queue to be run at appropriate time)
        if (this._representation.behaviours && this._representation.behaviours.during) {
            const duringBehaviours = this._representation.behaviours.during;
            duringBehaviours.forEach((behaviour) => {
                this._runSingleDuringBehaviour(behaviour);
            });
        }
    }

    /**
     * Runs the single during behaviour
     */
    _runSingleDuringBehaviour(behaviour: Object) {
        const behaviourRunner = this.getBehaviourRenderer(behaviour.behaviour.type);
        if (behaviourRunner) {
            const startCallback = () => {
                logger.info(`started during behaviour ${behaviour.behaviour.type}`);
                this._analytics({
                    type: AnalyticEvents.types.RENDERER_ACTION,
                    name: AnalyticEvents.names.DURING_BEHAVIOUR_STARTED,
                    from: behaviour.behaviour.type,
                    to: '',
                });
                behaviourRunner(behaviour.behaviour, () =>
                    logger.info(`completed during behaviour ${behaviour.behaviour.type}`));
            }
            if (this._willHideControls(behaviour.behaviour)) {
                this._hideControls(behaviour.start_time);
            }
            const startTime = behaviour.start_time;
            const endTime = getBehaviourEndTime(behaviour);
            const clearFunction = () => {
                const behaviourElement = document.getElementById(behaviour.behaviour.id);
                if (behaviourElement && behaviourElement.parentNode) {
                    behaviourElement.parentNode.removeChild(behaviourElement);
                }
                this._showControls();
            };
            const listenerId = behaviour.behaviour.id;
            this.addTimeEventListener(
                listenerId,
                startTime,
                startCallback,
                endTime,
                clearFunction,
            );
        } else {
            logger.warn(`${this.constructor.name} does not support ` +
                `${behaviour.behaviour.type} - ignoring`)
        }
    }

    // //////////// show link choice behaviour
    _applyShowChoiceBehaviour(behaviour: Object, callback: () => mixed) {

        this._player.on(PlayerEvents.LINK_CHOSEN, this._handleLinkChoiceEvent);

        this._linkChoiceBehaviourOverlay = this._player.createBehaviourOverlay(behaviour);
        this._setBehaviourElementAttribute(
            this._linkChoiceBehaviourOverlay.getOverlay(), 'link-choice');

        this._choiceBehaviourData = {
            choiceIconNEObjects: null,
            behaviour,
            callback,
        };
        // listen for variable changes and update choices to reflect
        this._controller.on(VARIABLE_EVENTS.CONTROLLER_CHANGED_VARIABLE, this._renderLinkChoices);

        // show them in current state
        return this._renderLinkChoices();
    }

    // have the choices available changed
    // compare new NE objects to those we have at the moment
    _choicesHaveChanged(newNEObjects: Array<Object>) {
        const { choiceIconNEObjects } = this._choiceBehaviourData;
        if (choiceIconNEObjects.length !== newNEObjects.length) return true;
        let allNesStillIn = true;
        newNEObjects.forEach((neo) => {
            if (!choiceIconNEObjects.find(
                (e) => e.targetNeId === neo.targetNeId)) {
                allNesStillIn = false;
            }
        });
        return !allNesStillIn;
    }

    _renderLinkChoices() {
        const { behaviour, callback, choiceIconNEObjects } = this._choiceBehaviourData;
        // get behaviours of links from data
        const {
            showNeToEnd,
            countdown,
            disableControls,
            iconOverlayClass,
            forceChoice,
            oneShot,
            showIfOneLink,
        } = this._getLinkChoiceBehaviours(behaviour);

        this._linkBehaviour = {
            showNeToEnd,
            oneShot,
            forceChoice,
            callback: forceChoice ? callback : () => {},
        };

        const behaviourOverlay = this._linkChoiceBehaviourOverlay;
        if (disableControls) {
            // if during behaviour, this should have happened already
            // if start/end behaviour then not
            this._player.disableControls();
        }

        // get valid links
        return this._controller.getValidNextSteps().then((narrativeElementObjects) => {
            if (choiceIconNEObjects !== null) {
                if (this._choicesHaveChanged(narrativeElementObjects)) {
                    logger.info('Variable state has changed valid links - need to refresh icons');
                    this._clearChoices();
                    behaviourOverlay.clearAll();
                } else {
                    logger.info('Variable state has changed, but same link options valid');
                    return Promise.resolve();
                }
            }

            // save current set of icons so we can easily test if they need to be rebuilt
            // after a variable state change
            this._choiceBehaviourData.choiceIconNEObjects = narrativeElementObjects;
            if (narrativeElementObjects.length === 0) {
                logger.warn('Show link icons behaviour run, but no links are currently valid');
                this._player.enableControls();
                callback();
                return Promise.resolve();
            }

            // abort now if only one link and not showIfOneLink
            if (narrativeElementObjects.length === 1 && !showIfOneLink) {
                logger.info('Link Choice behaviour ignored - only one link');
                this._player.enableControls();
                callback();
                return Promise.resolve();
            }

            // find out which link is default
            const defaultLinkId = this._getDefaultLink(narrativeElementObjects);

            // go through asset collections and render icons
            return this._getIconSourceUrls(narrativeElementObjects, behaviour)
                .then((iconObjects) => {

                    this._clearChoices();
                    iconObjects.forEach((iconSpecObject) => {
                        this._buildLinkIcon(iconSpecObject, behaviourOverlay.getOverlay());
                    });
                    if (iconObjects.length > 1 || showIfOneLink) {
                        this._showChoiceIcons({
                            defaultLinkId, // id for link to highlight at start
                            forceChoice, // do we highlight
                            disableControls, // are controls disabled while icons shown
                            countdown, // do we animate countdown
                            iconOverlayClass, // css classes to apply to overlay

                            behaviourOverlay,
                            choiceCount: iconObjects.length,
                        });

                        // callback to say behaviour is done, but not if user can
                        // change their mind
                        if (!forceChoice) {
                            callback();
                        }
                    } else {
                        logger.info('Link Choice behaviour ignored - only one link');
                        this._linkBehaviour.forceChoice = false;
                        callback();
                    }
                }).catch((err) => {
                    logger.error(err, 'could not get assets for rendering link icons');
                    callback();
                });
        }).catch((err) => {
            logger.error(err, 'Could not get next steps for rendering links');
            callback();
        });
    }

    // handler for user clicking on link choice
    _handleLinkChoiceEvent(eventObject: Object) {
        this._followLink(eventObject.id, eventObject.behaviourId);
    }

    // get behaviours of links from behaviour meta data
    _getLinkChoiceBehaviours(behaviour: Object): Object {
        // set default behaviours if not specified in data model
        let countdown = false;
        let disableControls = true;
        let iconOverlayClass = null;
        let forceChoice = false;
        let oneShot = false;
        let showNeToEnd = true;
        let showIfOneLink = false;

        // and override if they are specified
        if (behaviour.hasOwnProperty('show_ne_to_end')) {
            showNeToEnd = behaviour.show_ne_to_end;
        }
        if (behaviour.hasOwnProperty('one_shot')) {
            oneShot = behaviour.one_shot;
        }
        if (behaviour.hasOwnProperty('show_if_one_choice')) {
            showIfOneLink = behaviour.show_if_one_choice;
        }
        // do we show countdown?
        if (behaviour.hasOwnProperty('show_time_remaining')) {
            countdown = behaviour.show_time_remaining;
        }
        // do we disable controls while choosing
        if (behaviour.hasOwnProperty('disable_controls')) {
            disableControls = behaviour.disable_controls;
        }
        // do we apply any special css classes to the overlay
        if (behaviour.hasOwnProperty('overlay_class')) {
            iconOverlayClass = behaviour.overlay_class;
        }
        if (behaviour.hasOwnProperty('force_choice')) {
            forceChoice = behaviour.force_choice;
        }

        return {
            showNeToEnd,
            countdown,
            disableControls,
            iconOverlayClass,
            forceChoice,
            oneShot,
            showIfOneLink,
        };
    }

    // get data objects including resolved src urls for icons to represent link choices
    _getIconSourceUrls(
        narrativeElementObjects: Array<Object>,
        behaviour: Object,
    ): Promise<Array<Object>> {
        const iconObjectPromises: Array<Promise<Object>> = [];
        narrativeElementObjects.forEach((choiceNarrativeElementObj, i) => {
            logger.info(`choice ${(i + 1)}: ${choiceNarrativeElementObj.ne.id}`);
            // blank object describing each icon
            const iconSpecObject = {
                choiceId: i,
                acId: null,
                ac: null,
                resolvedUrl: null,
                targetNarrativeElementId: choiceNarrativeElementObj.targetNeId,
                iconText: null,
            };
            // first get an asset collection id for each icon
            // firstly is there an  icon specified in the behaviour
            if (behaviour.link_icons) {
                behaviour.link_icons.forEach((linkIconObject) => {
                    // eslint-disable-next-line max-len
                    if (linkIconObject.target_narrative_element_id === choiceNarrativeElementObj.targetNeId) {
                        if (linkIconObject.image) {
                            // map representation to asset
                            iconSpecObject.acId =
                                this.resolveBehaviourAssetCollectionMappingId(linkIconObject.image);
                            // inject any other properties in data model into the object
                            Object.keys(linkIconObject).forEach((key) => {
                                if (key !== 'image') {
                                    iconSpecObject[key] = linkIconObject[key];
                                }
                            });
                        }
                        if (linkIconObject.text) {
                            iconSpecObject.iconText = linkIconObject.text;
                        }
                    }
                });
            }
            iconObjectPromises.push(Promise.resolve(iconSpecObject));
        });

        return Promise.all(iconObjectPromises).then((iconSpecObjects) => {
            // next resolve asset collection ids into asset collection objects
            const iconAssetCollectionPromises = [];
            iconSpecObjects.forEach((iconSpecObj) => {
                if (iconSpecObj.acId) {
                    iconAssetCollectionPromises.push(this._fetchAssetCollection(iconSpecObj.acId));
                } else {
                    iconAssetCollectionPromises.push(Promise.resolve(null));
                }
            });
            return Promise.all(iconAssetCollectionPromises).then((resolvedAcs) => {
                resolvedAcs.forEach((resolvedAc, index) => {
                    const holdingObj = iconSpecObjects[index];
                    holdingObj.ac = resolvedAc;
                });
                return Promise.resolve(iconSpecObjects);
            });
        }).then((iconObjects) => {
            // next get src urls from each asset collection and resolve them using media fetcher
            const fetcherPromises = [];
            iconObjects.forEach((iconObject) => {
                if (iconObject && iconObject.ac && iconObject.ac.assets.image_src) {
                    // eslint-disable-next-line max-len
                    fetcherPromises.push(this._fetchMedia(iconObject.ac.assets.image_src, { includeCredentials: true }));
                } else {
                    fetcherPromises.push(Promise.resolve(''));
                }
            });
            return Promise.all(fetcherPromises).then((resolvedUrls) => {
                const returnObjects = [];
                resolvedUrls.forEach((resolvedUrl, i) => {
                    const obj = iconObjects[i];
                    obj.resolvedUrl = resolvedUrl;
                    returnObjects.push(obj);
                });
                return returnObjects;
            });
        });
    }

    // tell the player to build an icon
    // but won't show yet
    _buildLinkIcon(iconObject: Object, behaviourElement: HTMLElement) {
        // tell Player to build icon
        const targetId = iconObject.targetNarrativeElementId;
        let icon;
        if (iconObject.iconText && iconObject.resolvedUrl) {
            icon = this._player.addTextLinkIconChoice(
                behaviourElement,
                targetId,
                iconObject.iconText,
                iconObject.resolvedUrl,
                iconObject.iconText,
            );
        } else if (iconObject.iconText) {
            icon = this._player.addTextLinkChoice(
                behaviourElement,
                targetId,
                iconObject.iconText,
                iconObject.iconText,
            );
        } else if (iconObject.resolvedUrl) {
            icon = this._player.addLinkChoiceControl(
                behaviourElement,
                targetId,
                iconObject.resolvedUrl,
                `Option ${(iconObject.choiceId + 1)}`, // TODO - need sensible label
            );
        } else {
            logger.warn(`No icon specified for link to ${targetId} - not rendering`);
        }
        if (icon) icon.setAttribute('spatial-navigation-object', 'content');
        if (icon && iconObject.position && iconObject.position.two_d) {
            const {
                left,
                top,
            } = iconObject.position.two_d;
            let {
                width,
                height,
            } = iconObject.position.two_d;
            if (left !== undefined && top !== undefined
                && (width !== undefined || height !== undefined)) {
                if (width === undefined) {
                    width = height;
                } else if (height === undefined) {
                    height = width;
                }
                icon.style.position = 'absolute';
                icon.style.top = `${top}%`;
                icon.style.left = `${left}%`;
                icon.style.width = `${width}%`;
                icon.style.height = `${height}%`;
            }
        }
    }

    // tell the player to show the icons
    // parameter specifies how icons are presented
    _showChoiceIcons(iconDataObject: Object) {
        const {
            defaultLinkId, // id for link to highlight at start
            forceChoice,
            disableControls, // are controls disabled while icons shown
            countdown, // do we animate countdown
            iconOverlayClass, // css classes to apply to overlay
            behaviourOverlay,
            choiceCount,
        } = iconDataObject;

        this._player.showChoiceIcons(
            forceChoice ? null : defaultLinkId,
            iconOverlayClass,
            behaviourOverlay,
            choiceCount,
        ).then(() => {
            if (disableControls) {
                // disable transport controls
                this._player.disableControls();
            }
            if (countdown) {
                this._player.startChoiceCountdown(this);
            }
            this._player.enableLinkChoiceControl();
        }).catch((err) => { // REFACTOR: this returns a promise
            logger.error(err, 'could not render link choice icons')  ;
        });
    }

    // user has made a choice of link to follow - do it
    _followLink(narrativeElementId: string, behaviourId: string) {
        // if they are paused, then clicking a choice should restart
        if (!this._playoutEngine.isPlaying()) this.play();
        this._controller.off(VARIABLE_EVENTS.CONTROLLER_CHANGED_VARIABLE, this._renderLinkChoices);
        if (this._linkBehaviour) {
            this._linkBehaviour.forceChoice = false; // they have made their choice
        }
        const currentNarrativeElement = this._controller.getCurrentNarrativeElement();
        if (this._linkBehaviour && this._linkBehaviour.showNeToEnd) {
            // if not done so, save initial conditions
            // now make chosen link top option
            currentNarrativeElement.links.forEach((neLink) => {
                if (neLink.target_narrative_element_id === narrativeElementId) {
                    neLink.override_as_chosen = true; // eslint-disable-line no-param-reassign
                } else if (neLink.hasOwnProperty('override_as_chosen')) {
                    neLink.override_as_chosen = false; // eslint-disable-line no-param-reassign
                }
            });

            // if already ended, follow immediately
            if (this.hasMediaEnded()) {
                this._hideChoiceIcons(narrativeElementId, behaviourId);
            // do we keep the choice open?
            } else if (this._linkBehaviour && this._linkBehaviour.oneShot) {
                // hide icons
                this._hideChoiceIcons(null, behaviourId);
                // refresh next/prev so user can skip now if necessary
                this._controller.refreshPlayerControls();
                this._player.enableControls();
                this._player.showSeekButtons();
            }
        } else {
            // or follow link now
            this._hideChoiceIcons(narrativeElementId, behaviourId);
        }
    }

    _getDefaultLink(narrativeElementObjects: Array<Object>): ?string {
        const currentNarrativeElement = this._controller.getCurrentNarrativeElement();
        const validLinks = currentNarrativeElement.links.filter(link =>
            narrativeElementObjects.filter(ne =>
                ne.targetNeId === link.target_narrative_element_id).length > 0);

        const defaultLink = validLinks[0];

        return defaultLink && defaultLink.target_narrative_element_id;
    }


    // revert link conditions for current NE to what they were originally
    _reapplyLinkConditions() {
        const currentNarrativeElement = this._controller.getCurrentNarrativeElement();
        currentNarrativeElement.links.forEach((neLink) => {
            if (neLink.hasOwnProperty('override_as_chosen')) {
                neLink.override_as_chosen = false; // eslint-disable-line no-param-reassign
            }
        });
    }

    // hide the choice icons, and optionally follow the link
    _hideChoiceIcons(narrativeElementId: ?string, behaviourId: string) {
        if (narrativeElementId) { this._reapplyLinkConditions(); }
        const behaviourElement = document.getElementById(behaviourId);
        if (this._linkFadeTimeout) clearTimeout(this._linkFadeTimeout);
        if(behaviourElement) {
            this._linkFadeTimeout = setTimeout(() => {
                behaviourElement.classList.remove('romper-icon-fade');
                this._clearChoices();
                if (narrativeElementId) {
                    this._controller.followLink(narrativeElementId);
                } else {
                    this._linkBehaviour.callback();
                }
            }, 1500);
            behaviourElement.classList.add('romper-icon-fade');
        }
    }

    _clearChoices() {
        this._player.clearLinkChoices();
        if (this._linkFadeTimeout) clearTimeout(this._linkFadeTimeout);
        this._linkFadeTimeout = null;
    }

    // //////////// end of show link choice behaviour

    _applyColourOverlayBehaviour(behaviour: Object, callback: () => mixed) {
        const { colour } = behaviour;
        const overlayImageElement = document.createElement('div');
        this._setBehaviourElementAttribute(overlayImageElement, 'colour-overlay');
        overlayImageElement.style.background = colour;
        overlayImageElement.className = 'romper-image-overlay';
        this._target.appendChild(overlayImageElement);
        this._behaviourElements.push(overlayImageElement);
        callback();
    }

    _createFadeOverlay(behaviour: Object) {
        const { colour, id } = behaviour;
        const overlayImageElement = document.createElement('div');
        overlayImageElement.id = id;
        this._setBehaviourElementAttribute(overlayImageElement, 'colour-overlay');
        overlayImageElement.style.background = colour;
        overlayImageElement.className = 'romper-image-overlay';
        this._target.appendChild(overlayImageElement);
        this._behaviourElements.push(overlayImageElement);
        return overlayImageElement;
    }

    _applyFadeOutBehaviour(behaviour: Object, callback: () => mixed) {
        const { duration } = behaviour;
        const overlayImageElement = this._createFadeOverlay(behaviour);
        overlayImageElement.style.opacity = 0;
        overlayImageElement.style.transition = `opacity ${duration}s`;
 
        const startFade = () => { overlayImageElement.style.opacity = 1 };
        setTimeout(startFade, 500);
        callback();
    }

    _applyFadeInBehaviour(behaviour: Object, callback: () => mixed) {
        const { duration } = behaviour;
        const overlayImageElement = this._createFadeOverlay(behaviour);
        overlayImageElement.style.opacity = 1;
        overlayImageElement.style.transition = `opacity ${duration}s`;

        const startFade = () => { overlayImageElement.style.opacity = 0 };
        setTimeout(startFade, 500);
        callback();
    }

    // eslint-disable-next-line no-unused-vars
    _applyFadeAudioOutBehaviour(behaviour: Object, callback: () => mixed) {
        logger.warn(`${this._representation.type} representations do not support audio fade out`);
    }

    // eslint-disable-next-line no-unused-vars
    _applyFadeAudioInBehaviour(behaviour: Object, callback: () => mixed) {
        logger.warn(`${this._representation.type} representations do not support audio fade in`);
    }

    // REFACTOR note: these are called by the behaviour, without knowing what will happen
    // via behaviour map
    _applyShowImageBehaviour(behaviour: Object, callback: () => mixed) {
        const behaviourAssetCollectionMappingId = behaviour.image;
        const assetCollectionId =
            this.resolveBehaviourAssetCollectionMappingId(behaviourAssetCollectionMappingId);
        if (assetCollectionId) {
            this._fetchAssetCollection(assetCollectionId)
                .then((assetCollection) => {
                    if (assetCollection.assets.image_src) {
                        return this._fetchMedia(assetCollection.assets.image_src, { includeCredentials: true });
                    }
                    return Promise.resolve();
                })
                .then((imageUrl) => {
                    if (imageUrl) {
                        this._overlayImage(imageUrl, behaviour.id);
                    }
                    callback();
                })
                .catch((err) => {
                    logger.error(err, 'could not get image for show image behaviour');
                });
        } else {
            logger.error('No asset collection id for show image behaviour');
        }
    }

    _overlayImage(imageSrc: string, id: string) {
        const overlayImageElement = document.createElement('img');
        overlayImageElement.setAttribute('draggable', 'false');
        overlayImageElement.id = id;
        this._setBehaviourElementAttribute(overlayImageElement, 'image-overlay');
        overlayImageElement.src = imageSrc;
        overlayImageElement.className = 'romper-image-overlay notInteractiveContent';
        this._target.appendChild(overlayImageElement);
        this._behaviourElements.push(overlayImageElement);
    }

    _applySocialSharePanelBehaviour(behaviour: Object, callback: () => mixed) {
        const modalElement = renderSocialPopup(
            behaviour,
            this._player.getOverlayElement(),
            callback,
            this._analytics,
        );
        this._setBehaviourElementAttribute(modalElement, 'social-share');
        this._behaviourElements.push(modalElement);
    }

    _applyLinkOutBehaviour(behaviour: Object, callback: () => mixed) {
        const modalElement = renderLinkoutPopup(
            behaviour,
            this._player.getOverlayElement(),
            callback,
            this._analytics,
        );
        this._setBehaviourElementAttribute(modalElement, 'link-out');
        this._behaviourElements.push(modalElement);
    }

    _applyTextOverlayBehaviour(behaviour: Object, callback: () => mixed) {
        const modalElement = renderTextOverlay(
            behaviour,
            this._player.getOverlayElement(),
            callback,
            this._controller,
        );
        this._setBehaviourElementAttribute(modalElement, 'text-overlay');
        this._behaviourElements.push(modalElement);
    }

    _applyMapOverlayBehaviour(behaviour: Object, callback: () => mixed) {
        const modalElement = renderMapOverlay(
            behaviour,
            this._player.getOverlayElement(),
            callback,
            this._controller,
            this._analytics,
        );
        this._setBehaviourElementAttribute(modalElement, 'map-overlay');
        this._behaviourElements.push(modalElement);
    }

    _setBehaviourElementAttribute(element: HTMLElement, attributeValue: string) {
        element.setAttribute('data-behaviour', attributeValue)
        element.setAttribute('behaviour-renderer', this._rendererId);
    }

    // //////////// variables panel choice behaviour

    _setVariableValue(varName: string, value: any) {
        this._controller.getVariableValue(varName).then((oldVal) => {
            this._controller.setVariableValue(varName, value);
            const logData = {
                type: AnalyticEvents.types.USER_ACTION,
                name: AnalyticEvents.names.USER_SET_VARIABLE,
                from: `${varName}: ${oldVal}`,
                to: `${varName}: ${value}`,
            };
            this._analytics(logData);
        });
    }

    _applyShowVariablePanelBehaviour(behaviour: Object, callback: () => mixed) {
        buildPanel(
            behaviour,
            this._controller.getVariableState.bind(this._controller),
            this._controller.getVariableValue.bind(this._controller),
            this._setVariableValue.bind(this),
            callback,
            this._target,
            this._player,
            this,
            this._analytics,
        );
    }
    // //////////// end of variables panel choice behaviour

    _clearBehaviourElements() {
        const behaviourElements =
            document.querySelectorAll(`[behaviour-renderer="${this._rendererId}"]`);
        behaviourElements.forEach((be) => {
            try {
                if(be && be.parentNode) {
                    be.parentNode.removeChild(be);
                }
            } catch (e) {
                logger.warn(`could not remove behaviour element ${be.id} from Renderer`);
            }
        });
    }

    // Takes a UUID used in a behaviour and resolves it to an asset collection
    resolveBehaviourAssetCollectionMappingId(behaviourAssetCollectionMappingId: string) {
        if (this._representation.asset_collections.behaviours) {
            let returnId = null;
            this._representation.asset_collections.behaviours
                .some((assetCollectionsBehaviour) => {
                    if (assetCollectionsBehaviour.behaviour_asset_collection_mapping_id
                            === behaviourAssetCollectionMappingId) {
                        returnId = assetCollectionsBehaviour.asset_collection_id;
                        return true;
                    }
                    return false;
                });
            return returnId;
        }
        return null;
    }

    // can this render in a headset?
    // eslint-disable-next-line class-methods-use-this
    isVRViewable(): boolean {
        return false;
    }

    // set the renderer in/out of a pause behaviour
    setInPause(paused: boolean) {
        if (paused) this.pause();
        else this.play();
        this._inPauseBehaviourState = paused;
    }

    getInPause(): boolean {
        return this._inPauseBehaviourState;
    }

    /**
     * Destroy is called as this representation is unloaded from being visible.
     * You should leave the DOM as you left it.
     *
     * @return {void}
     */
    destroy() {
        logger.debug('PHASE destroying', this._representation.id, this.phase);
        if (this.phase === RENDERER_PHASES.DESTROYED) {
            // eslint-disable-next-line max-len
            logger.debug('PHASE destroying - already destroyed', this._representation.id, this.phase);
            return false;
        }
        if (this.phase !== RENDERER_PHASES.ENDED) {
            logger.debug('PHASE destroying need to end first');
            this.end();
        }
        this._clearBehaviourElements();
        if (this._behaviourRunner) {
            this._behaviourRunner.destroyBehaviours();
        }
        // we didn't find any behaviours to run, so emit completion event
        this.emit(RendererEvents.DESTROYED);
        this._destroyed = true;
        return true;
    }

    getController(): Controller {
        return this._controller;
    }

    _setPhase(phase: string) {
        // eslint-disable-next-line max-len
        logger.debug(`Renderer ${this._rendererId} for representation ${this._representation.id} entering ${phase} phase`);
        this.phase = phase;
    }
}
