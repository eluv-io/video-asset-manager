import {observable, action, flow} from "mobx";
import UrlJoin from "url-join";

class FormStore {
  @observable clips = [];
  @observable trailers = [];
  @observable images = [];
  @observable galleries = [];

  constructor(rootStore) {
    this.rootStore = rootStore;
    this.targets = {};
  }

  CreateLink(versionHash, linkTarget="/meta/asset_metadata") {
    if(versionHash === this.rootStore.params.versionHash) {
      return {
        "/": UrlJoin("./", linkTarget)
      };
    } else {
      return {
        "/": UrlJoin("/qfab", versionHash, linkTarget)
      };
    }
  }

  @action.bound
  SaveAsset = flow(function * () {
    const client = this.rootStore.client;

    const {libraryId, objectId} = this.rootStore.params;

    const writeToken = (yield client.EditContentObject({
      libraryId,
      objectId
    })).write_token;

    let clips = {};
    this.clips.forEach(({versionHash}, index) => {
      clips[index.toString()] = this.CreateLink(versionHash);
    });

    yield client.ReplaceMetadata({
      libraryId,
      objectId,
      writeToken,
      metadataSubtree: "asset_metadata/clips",
      metadata: clips
    });

    let trailers = {};
    this.trailers.forEach(({versionHash}, index) => {
      trailers[index.toString()] = this.CreateLink(versionHash);
    });

    yield client.ReplaceMetadata({
      libraryId,
      objectId,
      writeToken,
      metadataSubtree: "asset_metadata/trailers",
      metadata: trailers
    });

    yield client.FinalizeContentObject({
      libraryId,
      objectId,
      writeToken
    });

    yield client.SendMessage({
      options: {
        operation: "Complete",
        message: "Successfully updated asset"
      }
    });
  });

  @action.bound
  AddClip = flow(function * ({key, versionHash}) {
    yield this.RetrieveClip(versionHash);

    this[key].push({
      versionHash,
      ...this.targets[versionHash]
    });
  });

  @action.bound
  RemoveClip({key, index}) {
    this[key] = this[key].filter((_, i) => i !== index);
  }

  @action.bound
  SwapClip({key, i1, i2}) {
    const clip = this[key][i1];
    this[key][i1] = this[key][i2];
    this[key][i2] = clip;
  }

  // Retrieve information about a clip and add it to targets cache (if not present)
  RetrieveClip = flow(function * (versionHash) {
    const client = this.rootStore.client;

    if(!this.targets[versionHash]) {
      const title =
        (yield client.ContentObjectMetadata({
          versionHash: versionHash,
          metadataSubtree: "asset_metadata/title"
        })) ||
        (yield client.ContentObjectMetadata({
          versionHash: versionHash,
          metadataSubtree: "public/name"
        })) ||
        (yield client.ContentObjectMetadata({
          versionHash: versionHash,
          metadataSubtree: "name"
        }));

      const id = yield client.ContentObjectMetadata({
        versionHash: versionHash,
        metadataSubtree: "asset_metadata/ip_title_id"
      });

      this.targets[versionHash] = {id, title};
    }
  });

  LoadClips = flow(function * (metadata) {
    let clips = [];
    yield Promise.all(
      Object.keys(metadata).map(async key => {
        const index = parseInt(key);

        if(isNaN(index)) { return; }

        let targetHash = this.rootStore.params.versionHash;
        if(metadata[key]["/"].startsWith("/qfab/")) {
          targetHash = metadata[key]["/"].split("/")[2];
        }

        await this.RetrieveClip(targetHash);

        clips[index] = {
          versionHash: targetHash,
          ...this.targets[targetHash]
        };
      })
    );

    return clips;
  });

  InitializeFormData = flow(function * () {
    const assetMetadata = this.rootStore.assetMetadata;

    if(assetMetadata.clips) {
      this.clips = yield this.LoadClips(assetMetadata.clips);
    }

    if(assetMetadata.trailers) {
      this.trailers = yield this.LoadClips(assetMetadata.trailers);
    }
  })
}

export default FormStore;