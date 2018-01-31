// @flow

import type BackgroundRenderer from './BackgroundRenderer';
import type { MediaFetcher, AssetCollection } from '../romper';
import BackgroundAudioRenderer from './BackgroundAudioRenderer';
import Player from '../Player';

export default function BackgroundRendererFactory(
    assetCollectionType: string,
    assetCollection: AssetCollection,
    mediaFetcher: MediaFetcher,
    player: Player,
): ?BackgroundRenderer {
    const RENDERERS = {
        'urn:x-object-based-media:asset-collection-types:looping-audio/v1.0':
            BackgroundAudioRenderer,
    };

    let currentRenderer;

    if (assetCollectionType in RENDERERS) {
        const Renderer = RENDERERS[assetCollectionType];
        currentRenderer = new Renderer(
            assetCollection,
            mediaFetcher,
            player,
        );
    } else {
        console.error(`Do not know how to render background ${assetCollectionType}`);
    }
    return currentRenderer;
}
