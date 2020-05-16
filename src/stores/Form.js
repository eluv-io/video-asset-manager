import {observable, action, flow, toJS} from "mobx";
import {DateTime} from "luxon";
import UrlJoin from "url-join";

require("elv-components-js/src/utils/LimitedMap");

const Slugify = str =>
  (str || "").toLowerCase().replace(/ /g, "-").replace(/[^a-z0-9\-]/g,"");

class FormStore {
  @observable assetInfo = {};
  @observable images = [];
  @observable gallery = [];
  @observable playlists = [];
  @observable credits = {};

  @observable assets = {};

  @observable controls = [
    "credits",
    "gallery",
    "playlists"
  ];

  @observable availableAssetTypes = [
    "primary",
    "clip"
  ];

  @observable availableTitleTypes = [
    "collection",
    "episode",
    "season",
    "series",
    "site",
    "title",
  ];

  @observable defaultImageKeys = [
    "portrait",
    "landscape"
  ];

  @observable associatedAssets = [
    {
      name: "titles",
      label: "Titles",
      indexed: true,
      slugged: true,
      defaultable: true,
      orderable: true
    },
    {
      name: "series",
      label: "Series",
      asset_types: ["primary"],
      title_types: ["series"],
      for_title_types: ["site", "collection"],
      indexed: true,
      slugged: true,
      defaultable: false,
      orderable: true
    },
    {
      name: "seasons",
      label: "Seasons",
      asset_types: ["primary"],
      title_types: ["season"],
      for_title_types: ["series"],
      indexed: true,
      slugged: true,
      defaultable: false,
      orderable: true
    },
    {
      name: "episodes",
      label: "Episodes",
      asset_types: ["primary"],
      title_types: ["episode"],
      for_title_types: ["season"],
      indexed: true,
      slugged: true,
      defaultable: false,
      orderable: true
    }
  ];

  @observable infoFields = [
    {name: "release_date", type: "date"},
    {name: "synopsis", type: "textarea"},
    {name: "copyright"},
    {name: "creator"},
    {name: "runtime", type: "integer"},
  ];

  @observable slugWarning = false;

  constructor(rootStore) {
    this.rootStore = rootStore;
    this.targets = {};
    this.linkHashes = {};
  }

  HasControl(control) {
    return this.controls.includes(control);
  }

  CreateLink(versionHash, linkTarget="/meta/public/asset_metadata", options={}) {
    if(!versionHash || versionHash === this.rootStore.params.versionHash) {
      return {
        ...options,
        ".": {"auto_update":{"tag":"latest"}},
        "/": UrlJoin("./", linkTarget)
      };
    } else {
      return {
        ...options,
        ".": {"auto_update":{"tag":"latest"}},
        "/": UrlJoin("/qfab", versionHash, linkTarget)
      };
    }
  }

  InitializeFormData = flow(function * () {
    const assetMetadata = this.rootStore.assetMetadata || {};

    const titleConfiguration = this.rootStore.titleConfiguration;

    this.controls = titleConfiguration.controls || this.controls;
    this.availableAssetTypes = titleConfiguration.asset_types || this.availableAssetTypes;
    this.availableTitleTypes = titleConfiguration.title_types || this.availableTitleTypes;
    this.infoFields = titleConfiguration.info_fields || this.infoFields;
    this.associatedAssets = titleConfiguration.associated_assets || this.associatedAssets;
    this.defaultImageKeys = titleConfiguration.default_image_keys || this.defaultImageKeys;

    this.assetInfo = this.LoadAssetInfo(assetMetadata);
    this.credits = this.LoadCredits((assetMetadata.info || {}).talent);
    this.images = yield this.LoadImages(assetMetadata.images, true);
    this.gallery = yield this.LoadGallery(assetMetadata.gallery);
    this.playlists = yield this.LoadPlaylists(assetMetadata.playlists);

    // Load all clip types
    for(let i = 0; i < this.associatedAssets.length; i++) {
      const name = this.associatedAssets[i].name;

      this.assets[name] = yield this.LoadAssets(
        assetMetadata[name],
        `public/asset_metadata/${name}`
      );
    }
  });

  @action.bound
  UpdateAssetInfo(key, value) {
    this.assetInfo[key] = value;

    if(key === "display_title" && !this.originalSlug) {
      this.assetInfo.slug = Slugify(value);
    } else if(key === "slug" && this.originalSlug) {
      this.slugWarning = this.originalSlug !== value;
    }
  }

  // Credits

  @action.bound
  AddCreditGroup() {
    this.credits.push({
      group: "",
      talentType: "",
      credits: []
    });
  }

  @action.bound
  RemoveCreditGroup({groupIndex}) {
    this.credits =
      this.credits.filter((_, i) => i !== groupIndex);
  }

  @action.bound
  UpdateCreditGroup({groupIndex, key, value}) {
    this.credits[groupIndex][key] = value;
  }

  @action.bound
  AddCredit({groupIndex}) {
    this.credits[groupIndex].credits.push({
      character_name: "",
      talent_first_name: "",
      talent_last_name: ""
    });
  }

  @action.bound
  UpdateCredit({groupIndex, creditIndex, key, value}) {
    this.credits[groupIndex].credits[creditIndex][key] = value;
  }

  @action.bound
  SwapCredit({groupIndex, i1, i2}) {
    const credit = this.credits[groupIndex].credits[i1];
    this.credits[groupIndex].credits[i1] = this.credits[groupIndex].credits[i2];
    this.credits[groupIndex].credits[i2] = credit;
  }

  @action.bound
  RemoveCredit({groupIndex, creditIndex}) {
    this.credits[groupIndex].credits =
      this.credits[groupIndex].credits.filter((_, i) => i !== creditIndex);
  }

  // Clips/trailers
  @action.bound
  AddClip = flow(function * ({key, playlistIndex, versionHash}) {
    yield this.RetrieveAsset(versionHash);

    if(playlistIndex !== undefined) {
      // Prevent duplicates
      if(this.playlists[playlistIndex].clips.find(clip => clip.versionHash === versionHash)) {
        return;
      }

      this.playlists[playlistIndex].clips.push({
        versionHash,
        ...this.targets[versionHash]
      });
    } else {
      // Prevent duplicates
      if(this.assets[key].find(clip => clip.versionHash === versionHash)) {
        return;
      }

      this.assets[key].push({
        versionHash,
        ...this.targets[versionHash]
      });
    }
  });

  @action.bound
  UpdateClip = flow(function * ({key, playlistIndex, index}) {
    let clip;
    if(playlistIndex !== undefined) {
      clip = this.playlists[playlistIndex].clips[index];
    } else {
      clip = this.assets[key][index];
    }

    if(clip.versionHash !== clip.latestVersionHash) {
      yield this.RetrieveAsset(clip.latestVersionHash);
    }

    const updatedClip = {
      ...clip,
      versionHash: clip.latestVersionHash,
      ...this.targets[clip.latestVersionHash]
    };

    if(playlistIndex !== undefined) {
      this.playlists[playlistIndex].clips[index] = updatedClip;
    } else {
      this.assets[key][index] = updatedClip;
    }
  });

  @action.bound
  RemoveClip({key, playlistIndex, index}) {
    if(playlistIndex !== undefined) {
      this.playlists[playlistIndex].clips =
        this.playlists[playlistIndex].clips.filter((_, i) => i !== index);
    } else {
      this.assets[key] = this.assets[key].filter((_, i) => i !== index);
    }
  }

  @action.bound
  SwapClip({key, playlistIndex, i1, i2}) {
    if(playlistIndex !== undefined) {
      const clip = this.playlists[playlistIndex].clips[i1];
      this.playlists[playlistIndex].clips[i1] = this.playlists[playlistIndex].clips[i2];
      this.playlists[playlistIndex].clips[i2] = clip;
    } else {
      const clip = this.assets[key][i1];
      this.assets[key][i1] = this.assets[key][i2];
      this.assets[key][i2] = clip;
    }
  }

  @action.bound
  SetDefaultClip({key, playlistIndex, index}) {
    const clips = playlistIndex !== undefined ?
      this.playlists[playlistIndex].clips :
      this.assets[key];

    let toUnset;
    if(clips[index].isDefault) {
      // Unset selected
      toUnset = index;
    } else {

      // Unset current default
      toUnset = clips.findIndex(clip => clip.isDefault);
    }

    if(toUnset >= 0) {
      playlistIndex !== undefined ?
        this.playlists[playlistIndex].clips[toUnset].isDefault = false :
        this.assets[key][toUnset].isDefault = false;
    }

    // Set new default
    if(toUnset !== index) {
      playlistIndex !== undefined ?
        this.playlists[playlistIndex].clips[index].isDefault = true :
        this.assets[key][index].isDefault = true;
    }
  }

  // Images
  @action.bound
  UpdateImage({index, imageKey, imagePath, targetHash}) {
    this.images[index] = {
      imageKey,
      imagePath,
      targetHash
    };
  }

  @action.bound
  AddImage() {
    this.images.push({
      imageKey: "",
      imagePath: undefined,
      targetHash: this.rootStore.params.versionHash
    });
  }

  @action.bound
  RemoveImage(index) {
    this.images = this.images.filter((_, i) => i !== index);
  }

  // Gallery images
  @action.bound
  UpdateGalleryImage({index, title, description, imagePath, targetHash}) {
    this.gallery[index] = {
      title,
      description,
      imagePath,
      targetHash
    };
  }

  @action.bound
  AddGalleryImage() {
    this.gallery.push({
      title: "",
      description: "",
      imagePath: undefined,
      targetHash: this.rootStore.params.versionHash
    });
  }

  @action.bound
  RemoveGalleryImage(index) {
    this.gallery = this.gallery.filter((_, i) => i !== index);
  }

  @action.bound
  SwapGalleryImage(i1, i2) {
    const image = this.gallery[i1];
    this.gallery[i1] = this.gallery[i2];
    this.gallery[i2] = image;
  }

  // Playlists
  @action.bound
  AddPlaylist() {
    this.playlists.push({
      playlistSlug: "New Playlist",
      clips: []
    });
  }

  @action.bound
  UpdatePlaylist({index, key, value}) {
    this.playlists[index][key] = value;
  }

  @action.bound
  RemovePlaylist(index) {
    this.playlists = this.playlists.filter((_, i) => i !== index);
  }

  @action.bound
  SwapPlaylist(i1, i2) {
    const playlist = this.playlists[i1];
    this.playlists[i1] = this.playlists[i2];
    this.playlists[i2] = playlist;
  }

  LoadInfoFields({infoFields, values, isTopLevel=false, topLevelValues}) {
    let info = {};
    infoFields.forEach(({name, type, top_level, fields}) => {
      if(isTopLevel && top_level) {
        info[name] = topLevelValues[name] || "";
      } else {
        info[name] = values[name] || "";
      }

      if((type === "date" || type === "datetime") && info[name]) {
        const date = DateTime.fromISO(values[name]);

        if(!date || date.invalid) {
          info[name] = undefined;
        } else {
          info[name] = date.ts;
        }
      } else if(type === "list" && info[name]) {
        info[name] = (info[name] || []).map(listValues =>
          this.LoadInfoFields({infoFields: fields, values: listValues})
        );
      }
    });

    return info;
  }

  // Load methods
  LoadAssetInfo(metadata) {
    const info = (metadata.info || {});

    let assetInfo = {
      title: metadata.title || "",
      display_title: metadata.display_title || "",
      slug: metadata.slug || Slugify(metadata.display_title || ""),
      ip_title_id: metadata.ip_title_id || "",
      title_type: metadata.title_type || this.availableTitleTypes[0],
      asset_type: metadata.asset_type || this.availableAssetTypes[0]
    };

    this.originalSlug = assetInfo.slug;

    const loadedInfo = this.LoadInfoFields({
      infoFields: this.infoFields,
      values: info,
      isTopLevel: true,
      topLevelValues: metadata
    });

    assetInfo = {
      ...assetInfo,
      ...loadedInfo
    };

    return assetInfo;
  }

  LoadCredits(metadata) {
    if(!metadata) { return []; }

    let credits = [];
    Object.keys(metadata).map(groupName => {
      let withSeqId = [];
      let withoutSeqId = [];

      metadata[groupName].forEach(credit => {
        // Ensure credit fields are strings
        [
          "character_name",
          "talent_first_name",
          "talent_last_name",
          "other_credits",
          "sales_display_order"
        ]
          .forEach(key => {
            if(typeof credit[key] !== "string") {
              credit[key] = "";
            }
          });

        if(credit.talent_note_seq_id) {
          const index = parseInt(credit.talent_note_seq_id) - 1;
          withSeqId[index] = credit;
        } else {
          withoutSeqId.push(credit);
        }
      });

      credits.push({
        group: groupName,
        talentType: (metadata[groupName][0] || {}).talent_type,
        credits: withSeqId
          .filter(credit => credit)
          .concat(withoutSeqId)
      });
    });

    return credits;
  }

  RetrieveAssetFromLink = flow(function * (linkPath) {
    if(!this.linkHashes[linkPath]) {
      const metadata = yield (yield this.rootStore.client.ContentObjectMetadata({
        versionHash: this.rootStore.params.versionHash,
        metadataSubtree: linkPath,
        resolveLinks: true,
        resolveIncludeSource: true
      })) || {};

      this.linkHashes[linkPath] = metadata["."].source;

      // Cache metadata
      yield this.RetrieveAsset(this.linkHashes[linkPath], metadata);
    }

    return this.linkHashes[linkPath];
  });

  // Retrieve information about a clip and add it to targets cache (if not present)
  RetrieveAsset = flow(function * (versionHash, assetMetadata) {
    if(this.targets[versionHash]) { return; }

    if(!assetMetadata) {
      assetMetadata = (yield this.rootStore.client.ContentObjectMetadata({
        versionHash,
        metadataSubtree: "public/asset_metadata"
      })) || {};
    }

    const latestVersionHash = yield this.rootStore.client.LatestVersionHash({versionHash});
    this.targets[versionHash] = {
      id: assetMetadata.ip_title_id,
      assetType: assetMetadata.asset_type,
      title: assetMetadata.title || assetMetadata.display_title,
      displayTitle: assetMetadata.display_title || assetMetadata.title,
      slug: assetMetadata.slug,
      playable: !!(assetMetadata.sources || {}).default,
      latestVersionHash
    };
  });

  LoadAssets = flow(function * (metadata, linkPath) {
    if(!metadata) { return []; }

    let assets = [];
    let unorderedAssets = [];
    let defaultAsset;

    metadata = toJS(metadata);

    // When slugged but not indexed, default choice is duplicated in the 'default' and slug keys.
    if(metadata.default) {
      let defaultMeta = metadata.default;
      if(!defaultMeta["/"]) {
        // Indexed + slugged lists are saved like {"default": {"<slug>": <link>}}
        defaultMeta = defaultMeta[Object.keys(defaultMeta)[0]];
      }

      const defaultSlug = defaultMeta["/"].split("/").pop();
      delete metadata[defaultSlug];
    }

    const keys = Array.isArray(metadata) ?
      [...new Array(metadata.length).keys()] :
      Object.keys(metadata);

    yield keys.limitedMap(
      10,
      async key => {
        try {
          if(!metadata[key]) { return; }

          const hasSlug = !metadata[key]["/"];
          const slug = hasSlug ? Object.keys(metadata[key])[0] : undefined;

          const targetHash = await this.RetrieveAssetFromLink(UrlJoin(linkPath, key.toString(), slug || ""));

          // Order might be saved in the link
          let order = ((hasSlug ? metadata[key][slug] : metadata[key]) || {}).order;

          const asset = {
            versionHash: targetHash,
            isDefault: false,
            ...this.targets[targetHash]
          };

          if(key === "default") {
            asset.isDefault = true;
            defaultAsset = asset;
            return;
          }

          // Keys are ordered indices
          const index = order !== undefined ? order : parseInt(key);
          if(isNaN(index)) {
            // Key not an index, just add it to the back of the list
            unorderedAssets.push(asset);
            return;
          }

          assets[index] = asset;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to load asset '${key}':`);
          // eslint-disable-next-line no-console
          console.error(toJS(metadata));
          // eslint-disable-next-line no-console
          console.error(error);
        }
      }
    );

    // Put default at front of list
    if(defaultAsset) {
      assets.unshift(defaultAsset);
    }

    assets = [
      ...assets,
      ...unorderedAssets
    ];

    // Filter any missing indices
    assets = assets.filter(asset => asset);

    return assets;
  });

  LoadImages = flow(function * (metadata) {
    let images = [];
    let imageTargets = [];
    if(metadata) {
      Object.keys(metadata).forEach(async imageKey => {
        try {
          const link = metadata[imageKey].default;

          if(!link || !link["/"]) {
            return;
          }

          let targetHash = this.rootStore.params.versionHash;
          let imagePath = link["/"].replace(/^\.\/files\//, "");
          if(link["/"].startsWith("/qfab/")) {
            targetHash = link["/"].split("/")[2];
            imagePath = link["/"].split("/").slice(4).join("/");
          }

          if(!imageTargets.includes(targetHash)) {
            imageTargets.push(targetHash);
          }

          images.push({
            imageKey,
            imagePath,
            targetHash
          });
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to load image '${imageKey}':`);
          // eslint-disable-next-line no-console
          console.error(toJS(metadata));
          // eslint-disable-next-line no-console
          console.error(error);
        }
      });
    }

    this.defaultImageKeys.forEach(imageKey => {
      if(images.find(info => info.imageKey === imageKey)) { return; }

      images.push({
        imageKey,
        imagePath: undefined,
        targetHash: this.rootStore.params.versionHash
      });
    });

    images = images.sort((a, b) => a.imageKey < b.imageKey ? -1 : 1);

    // Ensure all base URLs are set for previews
    yield Promise.all(
      imageTargets.map(async versionHash =>
        await this.rootStore.contentStore.LoadBaseFileUrl(versionHash)
      )
    );

    return images;
  });

  LoadGallery = flow(function * (metadata) {
    if(!metadata) { return []; }

    let images = [];
    let imageTargets = [];

    Object.keys(metadata).forEach(async imageIndex => {
      try {
        const index = parseInt(imageIndex);

        if(isNaN(index)) { return; }

        const imageInfo = metadata[imageIndex];
        const link = imageInfo.image && imageInfo.image.default;

        if(!link || !link["/"]) { return; }

        let targetHash = this.rootStore.params.versionHash;
        let imagePath = link["/"].replace(/^\.\/files\//, "");
        if(link["/"].startsWith("/qfab/")) {
          targetHash = link["/"].split("/")[2];
          imagePath = link["/"].split("/").slice(4).join("/");
        }

        if(!imageTargets.includes(targetHash)) {
          imageTargets.push(targetHash);
        }

        images[index] = {
          title: imageInfo.title || "",
          description: imageInfo.description || "",
          imagePath,
          targetHash
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Failed to load gallery '${imageIndex}':`);
        // eslint-disable-next-line no-console
        console.error(toJS(metadata));
        // eslint-disable-next-line no-console
        console.error(error);
      }
    });

    // Remove any missing entries
    images = images.filter(image => image);

    // Ensure all base URLs are set for previews
    yield Promise.all(
      imageTargets.map(async versionHash =>
        await this.rootStore.contentStore.LoadBaseFileUrl(versionHash)
      )
    );

    return images;
  });

  LoadPlaylists = flow(function * (metadata) {
    if(!metadata) { return []; }

    let playlists = [];
    let unorderedPlaylists = [];
    if(metadata) {
      yield Promise.all(
        Object.keys(metadata).sort().map(async playlistIndex => {
          if(isNaN(parseInt(playlistIndex))) {
            // New format - [playlistSlug]: { ... }
            const playlist = {
              playlistName: metadata[playlistIndex].name || "",
              playlistSlug: playlistIndex,
              clips: await this.LoadAssets(
                metadata[playlistIndex].list,
                `public/asset_metadata/playlists/${playlistIndex}/list`
              )
            };

            if(metadata[playlistIndex].order !== undefined) {
              playlists[parseInt(metadata[playlistIndex].order)] = playlist;
            } else {
              unorderedPlaylists.push(playlist);
            }
          } else {
            // Old format: [index]: { [playlistSlug]: ... }
            const playlistSlug = Object.keys(metadata[playlistIndex])[0];

            playlists[parseInt(playlistIndex)] = {
              playlistName: playlistSlug || "",
              playlistSlug,
              clips: await this.LoadAssets(
                metadata[playlistIndex][playlistSlug],
                `public/asset_metadata/playlists/${playlistIndex}/${playlistSlug}`
              )
            };
          }
        })
      );
    }

    return [
      ...playlists.filter(playlist => playlist),
      ...unorderedPlaylists
    ];
  });

  async FormatAssets({assetType, assets}) {
    // If not slugged or indexed, asset is saved as array
    let formattedAssets = assetType.indexed || assetType.slugged ? {} : [];
    const hasDefault = assets.find(({isDefault}) => isDefault);
    let index = hasDefault ? 1 : 0;

    await Promise.all(
      (assets || []).map(async ({displayTitle, versionHash, isDefault}) => {
        const link = this.CreateLink(versionHash);

        let key;
        if(isDefault) {
          key = "default";
        } else {
          key = index;
          index += 1;
        }

        if(assetType.slugged) {
          const slug = (await this.rootStore.client.ContentObjectMetadata({
            versionHash,
            metadataSubtree: UrlJoin("public", "asset_metadata", "slug")
          })) || Slugify(displayTitle);

          if(assetType.indexed) {
            formattedAssets[key] = {
              [slug]: link
            };
          } else {
            if(key === "default") {
              formattedAssets.default = this.CreateLink(
                this.rootStore.params.versionHash,
                `/meta/public/asset_metadata/${assetType.name}/${slug}`,
                { order: 0 }
              );
              link.order = 0;
            } else {
              link.order = key;
            }

            // If slugged but not indexed, 'default' is link to regular slug
            formattedAssets[slug] = link;
          }
        } else if(assetType.indexed) {
          formattedAssets[key] = link;
        } else {
          formattedAssets.push(link);
        }
      })
    );

    return formattedAssets;
  }

  FormatDate(millis, datetime=false) {
    try {
      return datetime ?
        DateTime.fromMillis(millis).toISO({suppressMilliseconds: true}) :
        DateTime.fromMillis(millis).toFormat("yyyy-LL-dd");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to parse time for", name);
      // eslint-disable-next-line no-console
      console.error(error);
    }

    return "";
  }

  FormatFields({infoFields, values, titleType, isTopLevel=false}) {
    let topInfo = {};
    let info = {};
    let listFields = [];

    infoFields.forEach(({name, type, for_title_types, top_level, fields}) => {
      if(for_title_types && !for_title_types.includes(titleType)) { return; }

      let value = values[name];
      if(type === "integer") {
        value = parseInt(values[name]);
      } else if(type === "number") {
        value = parseFloat(values[name]);
      } else if(type === "date") {
        value = this.FormatDate(values[name]);
      } else if(type === "datetime") {
        value = this.FormatDate(values[name], true);
      } else if(type === "list") {
        value = (value || []).map(entry => {
          entry = toJS(entry);

          return (this.FormatFields({infoFields: fields, values: entry, titleType})).info;
        });
      }

      if(!isTopLevel) {
        info[name] = value;
      } else {
        if(type === "list" || type === "multiselect") {
          // List type - Since we're doing a merge on the info metadata, we must do an explicit replace call to modify lists
          listFields.push({name, value, top_level});
        } else if(top_level) {
          // Top level specified, keep value at root level `public/asset_metadata/
          topInfo[name] = value;
        } else {
          // Default case - field is in info
          info[name] = value;
        }
      }
    });

    return { info, topInfo, listFields };
  }

  @action.bound
  SaveAsset = flow(function * () {
    try {
      const client = this.rootStore.client;

      const {libraryId, objectId} = this.rootStore.params;

      const writeToken = (yield client.EditContentObject({
        libraryId,
        objectId
      })).write_token;

      if(!writeToken) {
        throw Error("Update request denied");
      }

      if(this.HasControl("live_stream")) {
        yield this.rootStore.liveStore.SaveLiveParameters({writeToken});
      }

      if(this.HasControl("channel")) {
        yield this.rootStore.channelStore.SaveChannelInfo({writeToken});
      }

      // Format asset info
      const assetInfo = toJS(this.assetInfo);
      const {info, topInfo, listFields} = this.FormatFields({
        infoFields: this.infoFields,
        values: assetInfo,
        titleType: assetInfo.title_type,
        isTopLevel: true
      });

      // Move built-in fields to top level info
      ["title", "display_title", "ip_title_id", "slug", "title_type", "asset_type"]
        .forEach(attr => topInfo[attr] = assetInfo[attr]);

      // Asset Info
      yield client.MergeMetadata({
        libraryId,
        objectId,
        writeToken,
        metadataSubtree: "public/asset_metadata/info",
        metadata: info
      });

      yield client.MergeMetadata({
        libraryId,
        objectId,
        writeToken,
        metadataSubtree: "public/asset_metadata",
        metadata: topInfo
      });

      // List types must be replaced, or else they will be merged
      yield Promise.all(
        listFields.map(async ({name, value, top_level}) => {
          await client.ReplaceMetadata({
            libraryId,
            objectId,
            writeToken,
            metadataSubtree: top_level ? `public/asset_metadata/${name}` : `public/asset_metadata/info/${name}`,
            metadata: value
          });
        })
      );

      // Credits
      let credits = {};
      toJS(this.credits).map(group => {
        credits[group.group] =
          group.credits.map((credit, index) => ({
            ...credit,
            talent_type: group.talentType,
            talent_note_seq_id: (index + 1).toString().padStart(2, "0"),
            sales_display_order: credit.sales_display_order ?
              credit.sales_display_order.padStart(2, "0") : ""
          }));
      });

      // Asset Info
      yield client.ReplaceMetadata({
        libraryId,
        objectId,
        writeToken,
        metadataSubtree: "public/asset_metadata/info/talent",
        metadata: credits
      });

      for(let i = 0; i < this.associatedAssets.length; i++) {
        const assetType = this.associatedAssets[i];
        const assets = toJS(this.assets[assetType.name]);

        const formattedAssets = yield this.FormatAssets({assetType, assets});

        yield client.ReplaceMetadata({
          libraryId,
          objectId,
          writeToken,
          metadataSubtree: `public/asset_metadata/${assetType.name}`,
          metadata: formattedAssets
        });
      }

      // Images
      let images = {};
      toJS(this.images).forEach(({imageKey, imagePath, targetHash}) => {
        if(!imageKey || !imagePath) {
          return;
        }

        images[imageKey] = {
          default: this.CreateLink(targetHash, UrlJoin("files", imagePath)),
          thumbnail: this.CreateLink(targetHash, UrlJoin("rep", "thumbnail", "files", imagePath))
        };
      });

      yield client.ReplaceMetadata({
        libraryId,
        objectId,
        writeToken,
        metadataSubtree: "public/asset_metadata/images",
        metadata: images
      });

      // Gallery
      let gallery = {};
      toJS(this.gallery).forEach(({title, description, imagePath, targetHash}, index) => {
        if(!imagePath) {
          return;
        }

        gallery[index.toString()] = {
          title,
          description,
          image: {
            default: this.CreateLink(targetHash, UrlJoin("files", imagePath)),
            thumbnail: this.CreateLink(targetHash, UrlJoin("rep", "thumbnail", "files", imagePath))
          }
        };
      });

      yield client.ReplaceMetadata({
        libraryId,
        objectId,
        writeToken,
        metadataSubtree: "public/asset_metadata/gallery",
        metadata: gallery
      });

      // Playlists
      let playlists = {};
      yield Promise.all(
        toJS(this.playlists).map(async ({playlistName, playlistSlug, clips}, index) => {
          if(!playlistSlug) {
            return;
          }

          const list = await this.FormatAssets({
            assetType: {
              indexed: false,
              slugged: true,
              name: `playlists/${playlistSlug}/list`
            },
            assets: clips
          });

          playlists[playlistSlug] = {
            name: playlistName || playlistSlug,
            count: clips.length,
            order: index,
            list
          };
        })
      );

      yield client.ReplaceMetadata({
        libraryId,
        objectId,
        writeToken,
        metadataSubtree: "public/asset_metadata/playlists",
        metadata: playlists
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
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Save failed:");
      // eslint-disable-next-line no-console
      console.error(error);

      throw error;
    }
  });
}

export default FormStore;
