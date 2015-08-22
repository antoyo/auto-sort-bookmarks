/*
 * Copyright (C) 2014-2015  Boucher, Antoni <bouanto@zoho.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

const { Cc, Ci, Cu } = require('chrome');
const { Class } = require('sdk/core/heritage');
const { emit } = require('sdk/event/core');
const { EventTarget } = require('sdk/event/target');
const _ = require('sdk/l10n').get;
const { prefs } = require('sdk/simple-prefs');
const { when } = require('sdk/system/unload');
const { merge } = require('sdk/util/object');
const bookmarkService = Cc['@mozilla.org/browser/nav-bookmarks-service;1'].getService(Ci.nsINavBookmarksService);
const historyService = Cc['@mozilla.org/browser/nav-history-service;1'].getService(Ci.nsINavHistoryService);
const { getDescription, hasDoNotSortAnnotation, hasRecursiveAnnotation, isRecursivelyExcluded, isLivemark, isSmartBookmark } = require('annotations');

Cu.import('resource://gre/modules/XPCOMUtils.jsm', this);

/**
 * Item class. Base class for bookmarks/folders/separators/live bookmarks/smart bookmarks.
 */
let Item = new Class({
    /**
     * Get the parent folder.
     * @return {Folder} The parent folder.
     */
    getFolder: function() {
        return createItem(bookmarkService.TYPE_FOLDER, this.parentID);
    },
    /**
     * Get an item.
     * @constructor
     */
    initialize: function(itemID, index, parentID) {
        this.id = itemID;
        this.setIndex(index);
        this.parentID = parentID;
    },
    /**
     * Save the new index.
     */
    saveIndex: function() {
        try {
            bookmarkService.setItemIndex(this.id, this.index);
        }
        catch(exception) {
            console.error('failed to move ' + this.id + '. ' + this.title + ' to ' + this.index + ' (' + this.url + ')');
        }
    },
    /**
     * Set the new `index` saving the old index.
     * @param {int} index The new index.
     */
    setIndex: function(index) {
        this.oldIndex = this.index || index;
        this.index = index;
    },
});

/**
 * Bookmark class.
 * @extends Item
 */
let Bookmark = new Class({
    extends: Item,
    /**
     * Get a bookmark.
     * @param {int} itemID The bookmark identifier.
     * @param {int} index The bookmark position.
     * @param {int} parentID The bookmark parent identifier.
     * @param {string} title The bookmark title.
     * @param {string} url The item URL.
     * @param {int} lastVisited The timestamp of the last visit.
     * @param {int} accessCount The access count.
     * @param {int} dateAdded The timestamp of the date added.
     * @param {int} lastModified The timestamp of the last modified date.
     * @constructor
     */
    initialize: function(itemID, index, parentID, title, dateAdded, lastModified, url, lastVisited, accessCount) {
        if(title === null || dateAdded === null || lastModified === null || url === null || lastVisited === null || accessCount === null) {
            console.error('Corrupted bookmark found. ID: ' + itemID + ' - Title: ' + title + ' - URL: ' + url);
            this.corrupted = true;
        }

        Item.prototype.initialize.call(this, itemID, index, parentID);
        this.title = title || '';
        this.url = url || '';
        this.lastVisited = lastVisited || 0;
        this.accessCount = accessCount || 0;
        this.dateAdded = dateAdded || 0;
        this.lastModified = lastModified || 0;
        this.order = prefs.bookmark_sort_order || 4;
        this.description = getDescription(this) || '';
        this.setKeyword();
    },
    /**
     * Fetch the keyword and set it to the current bookmark.
     */
    setKeyword: function() {
        let keyword = '';
        try {
            keyword = bookmarkService.getKeywordForBookmark(this.id);
            keyword = keyword || '';
        }
        catch(exception) {
            // Nothing to do.
        }

        this.keyword = keyword;
    },
});

function bookmarkExists(itemID) {
    return bookmarkService.getItemIndex(itemID) >= 0;
}

/**
 * Bookmark manager class.
 */
let BookmarkManager = new Class({
    /**
     * Create a bookmark observer.
     */
    createObserver: function() {
        let self = this;

        let bookmarkObserver = {
            onBeginUpdateBatch: function() {
                emit(self, 'begin-batch');
            },

            onEndUpdateBatch: function() {
                emit(self, 'end-batch');
            },

            onItemAdded: function(itemID, parentID, index, itemType, url, title) {
                emit(self, 'add', createItem(itemType, itemID, index, parentID, title));
            },

            onItemChanged: function(itemID, property, isAnnotationProperty, newValue, lastModified, itemType, parentID) {
                emit(self, 'change', createItem(itemType, itemID, undefined, parentID), property === '', property === 'bookmarkPropertiesDialog/folderLastUsed', isAnnotationProperty && (property === 'autosortbookmarks/donotsort' || property === 'autosortbookmarks/recursive'));
            },

            onItemMoved: function(itemID, oldParentID, oldIndex, newParentID, newIndex, itemType) {
                emit(self, 'move', createItem(itemType, itemID, undefined, newParentID));
            },

            onItemRemoved: function(itemID, parentID, index, itemType) {
                emit(self, 'remove', createItem(itemType, itemID, index, parentID, 'undefined'));
            },

            onItemVisited: function(itemID, visitID, time, transitionType, url, parentID) {
                emit(self, 'visit', createItem(bookmarkService.TYPE_BOOKMARK, itemID, undefined, parentID));
            },

            QueryInterface: XPCOMUtils.generateQI([Ci.nsINavBookmarkObserver]),
        };
        BookmarkManager.prototype.observers.push(bookmarkObserver);
        bookmarkService.addObserver(bookmarkObserver, false);
    },

    extends: EventTarget,
    /**
     * Create a new bookmark observer.
     * @constructor
     */
    initialize: function initialize(options) {
        EventTarget.prototype.initialize.call(this, options);
        merge(this, options);
        this.createObserver();
    },
});

BookmarkManager.prototype.observers = [];

/**
 * Separator class.
 * @extends Item
 */
let Separator = new Class({
    extends: Item,
    /**
     * Get a separator.
     * @param {int} itemID The separator identifier.
     * @param {int} index The separator position.
     * @param {int} parentID The separator parent identifier.
     * @constructor
     */
    initialize: function(itemID, index, parentID) {
        Item.prototype.initialize.call(this, itemID, index, parentID);
    },
});

/**
 * Folder class.
 * @extends Bookmark
 */
let Folder = new Class({
    /**
     * Check if this folder can be sorted.
     * @return {boolean} Whether it can be sorted or not.
     */
    canBeSorted: function() {
        if(hasDoNotSortAnnotation(this.id) || this.hasAncestorExcluded()) {
            return false;
        }

        return !this.isRoot();
    },

    extends: Bookmark,
    /**
     * Get the immediate children.
     * @return {Array.<Item>} The children.
     */
    getChildren: function() {
        let index = 0;

        this.children = [[]];

        let options = historyService.getNewQueryOptions();
        options.queryType = historyService.QUERY_TYPE_BOOKMARKS;

        let query = historyService.getNewQuery();
        query.setFolders([this.id], 1);

        let result = historyService.executeQuery(query, options);

        let rootNode = result.root;
        rootNode.containerOpen = true;

        for(let i = 0 ; i < rootNode.childCount ; ++i) {
            let node = rootNode.getChild(i);
            let item = createItemFromNode(node, this.id);
            if(item instanceof Separator) {
                this.children.push([]);
                ++index;
            }
            else if(item !== undefined) {
                this.children[index].push(item);
            }
        }

        rootNode.containerOpen = false;

        return this.children;
    },
    /**
     * Generator yielding every folders recursively.
     */
    getFolders: function() {
        let folder;
        let node;

        let options = historyService.getNewQueryOptions();
        options.excludeItems = true;
        options.excludeQueries = true;
        options.queryType = historyService.QUERY_TYPE_BOOKMARKS;

        let query = historyService.getNewQuery();
        query.setFolders([this.id], 1);

        let result = historyService.executeQuery(query, options);

        let rootNode = result.root;
        rootNode.containerOpen = true;

        for(let i = 0 ; i < rootNode.childCount ; ++i) {
            node = rootNode.getChild(i);

            if(!isRecursivelyExcluded(node.itemId)) {
                folder = new Folder(node.itemId, node.bookmarkIndex, this.id, node.title, node.dateAdded, node.lastModified);

                if(!isLivemark(folder.id)) {
                    yield folder;

                    for(let folder of folder.getFolders()) {
                        yield folder;
                    }
                }
            }
        }

        rootNode.containerOpen = false;
    },
    /**
     * Check if this folder has an ancestor that is recursively excluded.
     */
    hasAncestorExcluded: function() {
        if(isRecursivelyExcluded(this.id)) {
            return true;
        }
        else {
            let parentID = bookmarkService.getFolderIdForItem(this.id);
            if(parentID > 0) {
                let parentFolder = createItem(bookmarkService.TYPE_FOLDER, parentID);
                return parentFolder.hasAncestorExcluded();
            }
        }

        return false;
    },
    /**
     * Check if at least one children has moved.
     * @return {boolean} Whether at least one children has moved or not.
     */
    hasMove: function() {
        for(let i = 0 ; i < this.children.length ; ++i) {
            let length = this.children[i].length;
            for(let j = 0 ; j < length ; ++j) {
                if(this.children[i][j].index !== this.children[i][j].oldIndex) {
                    return true;
                }
            }
        }

        return false;
    },
    /**
     * Get an existing folder.
     * @param {int} itemID The folder identifier.
     * @param {int} index The folder position.
     * @param {int} parentID The folder parent identifier.
     * @param {string} title The folder title.
     * @constructor
     */
    initialize: function(itemID, index, parentID, title, dateAdded, lastModified) {
        Bookmark.prototype.initialize.call(this, itemID, index, parentID, title, dateAdded, lastModified);
        this.order = prefs.folder_sort_order || 1;
    },
    /**
     * Check if this folder is a root folder (menu, toolbar, unsorted).
     * @return {boolean} Whether this is a root folder or not.
     */
    isRoot: function() {
        return this.id === bookmarkService.placesRoot;
    },
    /**
     * Generator saving the new children positions.
     */
    save: function() {
        if(this.hasMove()) {
            for(let i = 0 ; i < this.children.length ; ++i) {
                let length = this.children[i].length;
                for(let j = 0 ; j < length ; ++j) {
                    this.children[i][j].saveIndex();
                    yield true;
                }
            }
        }
    },
});

/**
 * Livemark class.
 * @extends Bookmark
 */
let Livemark = new Class({
    extends: Bookmark,
    /**
     * Get an existing smart bookmark.
     * @param {int} itemID The folder identifier.
     * @param {int} index The folder position.
     * @param {int} parentID The folder parent identifier.
     * @param {string} title The folder title.
     * @constructor
     */
    initialize: function(itemID, index, parentID, title, dateAdded, lastModified) {
        Bookmark.prototype.initialize.call(this, itemID, index, parentID, title, dateAdded, lastModified);
        this.order = prefs.livemark_sort_order || 2;
    },
});

/**
 * Smart bookmark class.
 * @extends Bookmark
 */
let SmartBookmark = new Class({
    extends: Bookmark,
    /**
     * Get an existing smart bookmark.
     * @param {int} itemID The folder identifier.
     * @param {int} index The folder position.
     * @param {int} parentID The folder parent identifier.
     * @param {string} title The folder title.
     * @constructor
     */
    initialize: function(itemID, index, parentID, title) {
        Bookmark.prototype.initialize.call(this, itemID, index, parentID, title);
        this.order = prefs.smart_bookmark_sort_order || 3;
    },
});

/**
 * Create an item from the `type`.
 * @param {int} type The item type.
 * @param {int} itemID The item ID.
 * @param {int} parentID The parent ID.
 * @param {string} title The item title.
 * @param {string} url The item URL.
 * @param {int} lastVisited The timestamp of the last visit.
 * @param {int} accessCount The access count.
 * @param {int} dateAdded The timestamp of the date added.
 * @param {int} lastModified The timestamp of the last modified date.
 * @return {Item} The new item.
 */
function createItem(type, itemID, index, parentID, title, url, lastVisited, accessCount, dateAdded, lastModified) {
    let item;
    switch(type) {
        case bookmarkService.TYPE_BOOKMARK:
            if(isSmartBookmark(itemID)) {
                item = new SmartBookmark(itemID, index, parentID, title);
            }
            else {
                item = new Bookmark(itemID, index, parentID, title, dateAdded, lastModified, url, lastVisited, accessCount);
            }

            break;
        case bookmarkService.TYPE_FOLDER:
            if(isLivemark(itemID)) {
                item = new Livemark(itemID, index, parentID, title, dateAdded, lastModified);
            }
            else {
                item = new Folder(itemID, index, parentID, title, dateAdded, lastModified);
            }

            break;
        case bookmarkService.TYPE_SEPARATOR:
            item = new Separator(itemID, index, parentID);
            break;
    }
    return item;
}

/**
 * Create an item from the `node` type.
 * @param {object} node The node item.
 * @param {int} parentID The parent ID.
 * @return {Item} The new item.
 */
function createItemFromNode(node, parentID) {
    let type;
    switch(node.type) {
    case node.RESULT_TYPE_URI:
        type = bookmarkService.TYPE_BOOKMARK;
        break;
    case node.RESULT_TYPE_FOLDER:
        type = bookmarkService.TYPE_FOLDER;
        break;
    case node.RESULT_TYPE_SEPARATOR:
        type = bookmarkService.TYPE_SEPARATOR;
        break;
    case node.RESULT_TYPE_QUERY:
        type = bookmarkService.TYPE_BOOKMARK;
        break;
    }
    return createItem(type, node.itemId, node.bookmarkIndex, parentID, node.title, node.uri, node.time, node.accessCount, node.dateAdded, node.lastModified);
}

/**
 * Get the children folders of a folder.
 */
function getChildrenFolders(parentID) {
    let children = [];
    let folder;
    let node;

    let options = historyService.getNewQueryOptions();
    options.excludeItems = true;
    options.excludeQueries = true;
    options.queryType = historyService.QUERY_TYPE_BOOKMARKS;

    let query = historyService.getNewQuery();
    query.setFolders([parentID], 1);

    let result = historyService.executeQuery(query, options);

    let rootNode = result.root;
    rootNode.containerOpen = true;

    for(let i = 0 ; i < rootNode.childCount ; ++i) {
        node = rootNode.getChild(i);

        folder = new Folder(node.itemId, node.bookmarkIndex, parentID, node.title, node.dateAdded, node.lastModified);

        if(!isLivemark(folder.id)) {
            children.push({
                id: folder.id,
                title: folder.title,
                excluded: hasDoNotSortAnnotation(folder.id),
                recursivelyExcluded: hasRecursiveAnnotation(folder.id),
            });
        }
    }

    rootNode.containerOpen = false;

    return children;
}

/**
 * The bookmarks menu folder.
 * @type {Folder}
 */
let menuFolder = new Folder(bookmarkService.bookmarksMenuFolder);

/**
 * The bookmarks toolbar folder.
 * @type {Folder}
 */
let toolbarFolder = new Folder(bookmarkService.toolbarFolder);

/**
 * The unsorted bookmarks folder.
 * @type {Folder}
 */
let unsortedFolder = new Folder(bookmarkService.unfiledBookmarksFolder);

/**
 * Get the root folders.
 */
function getRootFolders() {
    let folders = [];
    for(let folder of [menuFolder, toolbarFolder, unsortedFolder]) {
        folders.push({
            id: folder.id,
            excluded: hasDoNotSortAnnotation(folder.id),
            recursivelyExcluded: hasRecursiveAnnotation(folder.id),
        });
    }

    folders[0].title = _('Bookmarks Menu');
    folders[1].title = _('Bookmarks Toolbar');
    folders[2].title = _('Unsorted Bookmarks');

    return folders;
}

exports.Bookmark = Bookmark;
exports.BookmarkManager = BookmarkManager;
exports.bookmarkExists = bookmarkExists;
exports.Folder = Folder;
exports.getChildrenFolders = getChildrenFolders;
exports.getRootFolders = getRootFolders;
exports.Livemark = Livemark;
exports.menuFolder = menuFolder;
exports.Separator = Separator;
exports.SmartBookmark = SmartBookmark;
exports.toolbarFolder = toolbarFolder;
exports.unsortedFolder = unsortedFolder;

when(function() {
    for(let observer of BookmarkManager.prototype.observers) {
        bookmarkService.removeObserver(observer);
    }
});
