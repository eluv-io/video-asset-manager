import React from "react";
import AsyncComponent from "./AsyncComponent";
import {inject, observer} from "mobx-react";
import PropTypes from "prop-types";
import Action from "elv-components-js/src/components/Action";

@observer
class BrowserList extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      filter: ""
    };

    this.List = this.List.bind(this);
  }

  List() {
    return (
      <div className="browser-container">
        <h3>{this.props.header}</h3>
        <h4>{this.props.subHeader}</h4>
        <input
          name="filter"
          placeholder="Filter..."
          className="browser-filter"
          onChange={event => this.setState({filter: event.target.value})}
          value={this.state.filter}
        />
        <ul className={`browser ${this.props.hashes ? "mono" : ""}`}>
          {(this.props.list || [])
            .filter(({name}) => name.toLowerCase().includes(this.state.filter.toLowerCase()))
            .map(({id, name, objectName, objectDescription, assetType}) => (
              <li key={`browse-entry-${id}`}>
                <button
                  title={objectName ? `${objectName}\n\n${id}${objectDescription ? `\n\n${objectDescription}` : ""}` : id}
                  onClick={() => this.props.Select(id)}
                >
                  <div>{ name }</div>
                  { assetType ? <div className="hint">{ assetType }</div> : null }
                </button>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  render() {
    return (
      <AsyncComponent
        Load={this.props.Load}
        render={this.List}
      />
    );
  }
}

BrowserList.propTypes = {
  header: PropTypes.string.isRequired,
  subHeader: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.element
  ]),
  list: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string,
      id: PropTypes.string
    })
  ),
  hashes: PropTypes.bool,
  Load: PropTypes.func.isRequired,
  Select: PropTypes.func.isRequired
};

@inject("contentStore")
@observer
class ContentBrowser extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      libraryId: undefined,
      objectId: undefined
    };
  }

  render() {
    let content;
    if(!this.state.libraryId) {
      content = (
        <React.Fragment>
          <div className="content-browser-actions">
            <Action
              className="back tertiary"
              onClick={this.props.onCancel}
            >
              Cancel
            </Action>
          </div>
          <BrowserList
            key="browser-list-libraries"
            header="Choose a library"
            list={this.props.contentStore.libraries}
            Load={this.props.contentStore.LoadLibraries}
            Select={libraryId => this.setState({libraryId})}
          />
        </React.Fragment>
      );
    } else if(!this.state.objectId) {
      const library = this.props.contentStore.libraries
        .find(({libraryId}) => libraryId === this.state.libraryId);

      let list = this.props.contentStore.objects[this.state.libraryId] || [];
      if(this.props.assetTypes && this.props.assetTypes.length > 0) {
        list = list.filter(item => this.props.assetTypes.includes(item.assetType));
      }

      if(this.props.titleTypes && this.props.titleTypes.length > 0) {
        list = list.filter(item => this.props.titleTypes.includes(item.titleType));
      }

      content = (
        <React.Fragment>
          <div className="content-browser-actions">
            <Action
              className="back secondary"
              onClick={() => this.setState({libraryId: undefined})}
            >
              Back
            </Action>
            <Action
              className="back tertiary"
              onClick={this.props.onCancel}
            >
              Cancel
            </Action>
          </div>
          <BrowserList
            key={`browser-list-${this.state.libraryId}`}
            header="Choose an object"
            subHeader={library.name}
            list={list}
            Load={async () => await this.props.contentStore.LoadObjects(this.state.libraryId)}
            Select={async objectId => {
              if(this.props.objectOnly) {
                await this.props.onComplete({
                  libraryId: this.state.libraryId,
                  objectId
                });
              } else {
                this.setState({objectId});
              }
            }}
          />
        </React.Fragment>
      );
    } else {
      const library = this.props.contentStore.libraries
        .find(({libraryId}) => libraryId === this.state.libraryId);
      const object = this.props.contentStore.objects[this.state.libraryId]
        .find(({objectId}) => objectId === this.state.objectId);

      content = (
        <React.Fragment>
          <div className="content-browser-actions">
            <Action
              className="back secondary"
              onClick={() => this.setState({objectId: undefined})}
            >
              Back
            </Action>
            <Action
              className="back tertiary"
              onClick={this.props.onCancel}
            >
              Cancel
            </Action>
          </div>
          <BrowserList
            key={`browser-list-${this.state.objectId}`}
            header="Choose a version"
            subHeader={<React.Fragment><div>{library.name}</div><div>{object.name}</div></React.Fragment>}
            list={this.props.contentStore.versions[this.state.objectId]}
            hashes={true}
            Load={async () => await this.props.contentStore.LoadVersions(this.state.libraryId, this.state.objectId)}
            Select={async versionHash => await this.props.onComplete({
              libraryId: this.state.libraryId,
              objectId: this.state.objectId,
              versionHash
            })}
          />
        </React.Fragment>
      );
    }

    return (
      <div className="content-browser">
        <h2>{this.props.header}</h2>
        { content }
      </div>
    );
  }
}

ContentBrowser.propTypes = {
  header: PropTypes.string,
  assetTypes: PropTypes.arrayOf(PropTypes.string),
  titleTypes: PropTypes.arrayOf(PropTypes.string),
  playableOnly: PropTypes.bool,
  objectOnly: PropTypes.bool,
  onComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired
};

export default ContentBrowser;
