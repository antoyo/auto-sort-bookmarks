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

/**
 *
 * TODO: add tests for new features (including testing with corrupted bookmarks, folders, separators, ...).
 * TODO: fix test-main, test-bookmark-sorter.
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 * TODO: use the Places Query API with the provided sort option.
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 * TODO: add style rule to disallow space before comma.
 * TODO: add style rule to disallow writing function* ().
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 * TODO: whenever an option is changed, call sortIfAuto().
 * TODO: translate the options in French.
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 * TODO: only delay the folder sort for new folder when the user is in the new bookmark dialog.
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 * FIXME: bug when moving a separator or moving across a separtor in auto sort mode (cannot reproduce — use the bookmark observer to log the actions you tried).
 * TODO: look for errors on rare case (sorting and deleting the same folder or trying to move a deleted item — make some error tests).
 *
 */

const _ = require('sdk/l10n').get;
const { has, reset, set } = require('sdk/preferences/service');
const self = require('sdk/self');
const data = self.data;
const simplePrefs = require('sdk/simple-prefs');
const prefs = simplePrefs.prefs;
const tabs = require('sdk/tabs');
const { Widget } = require('sdk/widget');
const windowUtils = require('sdk/window/utils');
const { setDoNotSortAnnotation, setRecursiveAnnotation } = require('annotations');
const { BookmarkManager, Folder, Separator, menuFolder, toolbarFolder, unsortedFolder } = require('bookmarks');
const bookmarkManager = new BookmarkManager({});
const { BookmarkSorter } = require('bookmark-sorter');
const { showConfigureFoldersToExclude } = require('configure-folders');
const { getOptionName, setPreferenceMaximum, setPreferenceMinimum } = require('options');
const SECOND = 1000;
const sortCriterias = [
        'title',
        'url',
        'description',
        'keyword',
        'dateAdded',
        'lastModified',
        'lastVisited',
        'accessCount',
        'revurl',
    ];

let bookmarkSorter = new BookmarkSorter();

/**
 * On begin batch callback.
 */
function onBeginBatch() {
    bookmarkSorter.stop();
}

/**
 * Sort `item` parent folder after the preferred delay.
 * @param {Item} item The item changed.
 */
function sortItemAfterDelay(item) {
    bookmarkSorter.sortFolders(item.getFolder(), prefs.delay * SECOND);
}

/**
 * Sort `item` parent folder after the folder delay.
 * @param {Item} item The item changed.
 */
function sortItemAfterFolderDelay(item) {
    bookmarkSorter.sortFolders(item.getFolder(), prefs.folder_delay * SECOND);
}

/**
 * Sort recursively `item` folder after the preferred delay.
 * @param {Item} item The item changed.
 */
function sortChildrenAfterDelay(item) {
    function getItemPlusChildrenFolders() {
        yield item;
        for(let folder of item.getFolders()) {
            yield folder;
        }
    }

    bookmarkSorter.sortFolders(getItemPlusChildrenFolders(), prefs.delay * SECOND);
}

/**
 * Sort the item with the folder delay if it is a folder; otherwise, sort it with the normal delay.
 * @param {Item} item The item to sort.
 */
function sortFolderOrItem(item) {
    if(item instanceof Folder) {
        sortItemAfterFolderDelay(item);
    }
    else {
        sortItemAfterDelay(item);
    }
}

/**
 * On item change callback.
 */
function onChange(item, deleted, newFolder, annotationChange) {
    if(!deleted && !newFolder) {
        if(annotationChange) {
            sortChildrenAfterDelay(item);
        }
        else {
            sortFolderOrItem(item);
        }
    }
}

/**
 * On end batch callback.
 */
function onEndBatch() {
    bookmarkSorter.start();
}

/**
 * On item remove callback.
 */
function onRemove(item) {
    if(item instanceof Separator) {
        sortItemAfterDelay(item);
    }
}

/**
 * Add the bookmark observer.
 */
function addBookmarkObserver() {
    bookmarkManager.on('begin-batch', onBeginBatch);
    bookmarkManager.on('end-batch', onEndBatch);
    bookmarkManager.on('add', sortFolderOrItem);
    bookmarkManager.on('change', onChange);
    bookmarkManager.on('move', sortFolderOrItem);
    bookmarkManager.on('remove', onRemove);
    bookmarkManager.on('visit', sortItemAfterDelay);
}

/**
 * Sort all bookmarks.
 */
function sortAllBookmarks() {
    bookmarkSorter.sortAllBookmarks();
}

/**
 * Remove the bookmark observer.
 */
function removeBookmarkObserver() {
    bookmarkManager.removeListener('begin-batch', onBeginBatch);
    bookmarkManager.removeListener('end-batch', onEndBatch);
    bookmarkManager.removeListener('add', sortFolderOrItem);
    bookmarkManager.removeListener('change', onChange);
    bookmarkManager.removeListener('move', sortFolderOrItem);
    bookmarkManager.removeListener('remove', onRemove);
    bookmarkManager.removeListener('visit', sortItemAfterDelay);
}

/**
 * Adjust the auto sorting feature.
 */
function adjustAutoSort() {
    removeBookmarkObserver();
    if(prefs.auto_sort) {
        addBookmarkObserver();
        sortAllBookmarks();
    }
}

/**
 * Adjust the first run preference.
 */
function adjustFirstRun() {
    let prefName = getOptionName('firstrun');

    if(has(prefName)) {
        set(prefName, false);
    }
    else {
        set(prefName, true);
        prefs.auto_sort = false;
    }
}

/**
 * Sort if the auto sort option is on.
 */
function sortIfAuto() {
    if(prefs.auto_sort) {
        sortAllBookmarks();
    }
}

/**
 * Adjust the sort criteria of the bookmark sorter.
 */
function adjustSortCriteria() {
    let differentFolderOrder = prefs.folder_sort_order !== prefs.livemark_sort_order && prefs.folder_sort_order !== prefs.smart_bookmark_sort_order && prefs.folder_sort_order !== prefs.bookmark_sort_order;
    bookmarkSorter.setCriteria(sortCriterias[prefs.sort_by], prefs.inverse,
            sortCriterias[prefs.then_sort_by] || undefined, prefs.then_inverse,
            sortCriterias[prefs.folder_sort_by], prefs.folder_inverse,
            differentFolderOrder, prefs.case_insensitive
    );
    sortIfAuto();
}

/**
 * Create the events.
 */
function createEvents() {
    simplePrefs.on('auto_sort', function() {
        adjustAutoSort();
    });

    let preferences = ['folder_sort_order', 'livemark_sort_order', 'smart_bookmark_sort_order', 'bookmark_sort_order'];

    for(let preference of preferences) {
        simplePrefs.on(preference, sortIfAuto);
    }

    simplePrefs.on('case_insensitive', adjustSortCriteria);
    simplePrefs.on('sort_by', adjustSortCriteria);
    simplePrefs.on('then_sort_by', adjustSortCriteria);
    simplePrefs.on('folder_sort_by', adjustSortCriteria);
    simplePrefs.on('inverse', adjustSortCriteria);
    simplePrefs.on('then_inverse', adjustSortCriteria);
    simplePrefs.on('folder_inverse', adjustSortCriteria);
    simplePrefs.on('folder_sort_order', adjustSortCriteria);
    simplePrefs.on('livemark_sort_order', adjustSortCriteria);
    simplePrefs.on('smart_bookmark_sort_order', adjustSortCriteria);
    simplePrefs.on('bookmark_sort_order', adjustSortCriteria);

    simplePrefs.on('exclude_folders', showConfigureFoldersToExclude(sortIfAuto));
}

/**
 * Show the addon options.
 */
function showOptions() {
    windowUtils.getMostRecentBrowserWindow().BrowserOpenAddonsMgr('addons://detail/' + self.id + '/preferences');
}

/**
 * Show confirmation on install.
 */
function showConfirmation() {
    tabs.open({
        url: data.url('confirmation.html'),
        onOpen: function(tab) {
            tab.on('ready', function() {
                let worker = tab.attach({
                    contentScriptFile: data.url('confirmation.js')
                });
                worker.port.on('button-clicked', function(message) {
                    switch(message) {
                        case 'button-yes':
                            prefs.auto_sort = true;
                            break;
                        case 'button-no':
                            // Do nothing.
                            break;
                        case 'button-change-options':
                            showOptions();
                            break;
                    }
                    tab.close();
                });

                worker.port.emit('show', data.url('icon-48.png'));
            });
        },
    });
}

/**
 * Create the widgets.
 */
function createWidgets(install) {
    Widget({
        id: 'auto-sort-bookmarks-sort-all-toolbar',
        contentURL: data.url('icon-16.png'),
        label: _('sort_bookmarks'),
        onClick: sortAllBookmarks,
    });

    if(install) {
        showConfirmation();
    }
}

/**
 * Unload function.
 */
function exit(reason) {
    if(reason === 'disable') {
        reset(getOptionName('firstrun'));
    }
}

/**
 * Migrate to set the default folder sort order and the default folders to exclude.
 */
function migrate(upgrade) {
    if(upgrade) {
        if(!prefs.migration) {
            prefs.migration = '2.7';
        }

        if(prefs.migration < '2.8') {
            if([0, 2, 4, 5].indexOf(prefs.sort_by) >= 0) {
                prefs.folder_sort_by = prefs.sort_by;
                prefs.folder_inverse = prefs.inverse;
            }

            if(prefs.sort_menu === false) {
                setDoNotSortAnnotation(menuFolder.id);
                setRecursiveAnnotation(menuFolder.id);
            }

            if(prefs.sort_toolbar === false) {
                setDoNotSortAnnotation(toolbarFolder.id);
                setRecursiveAnnotation(toolbarFolder.id);
            }

            if(prefs.sort_unsorted === false) {
                setDoNotSortAnnotation(unsortedFolder.id);
                setRecursiveAnnotation(unsortedFolder.id);
            }

            delete prefs.sort_menu;
            delete prefs.sort_toolbar;
            delete prefs.sort_unsorted;
        }

        prefs.migration = self.version;
    }
}

/**
 * Set the minimum and maximum of integer preferences.
 */
function setPreferenceMinimumMaximum() {
    let preferences = ['folder_sort_order', 'livemark_sort_order', 'smart_bookmark_sort_order', 'bookmark_sort_order'];
    for(let preference of preferences) {
        setPreferenceMinimum(preference, 1);
        setPreferenceMaximum(preference, 4);
    }

    setPreferenceMinimum('folder_delay', 3);
}

/**
 * Auto-sort Bookmarks is a firefox extension that automatically sorts bookmarks.
 */
function main(options) {
    migrate(options.loadReason === 'upgrade');
    adjustFirstRun();
    createWidgets(options.loadReason === 'install');
    adjustSortCriteria();
    adjustAutoSort();
    createEvents();
    setPreferenceMinimumMaximum();
    adjustFirstRun();
}

exports.main = main;
exports.onUnload = exit;

exports.adjustAutoSort = adjustAutoSort;
exports.adjustSortCriteria = adjustSortCriteria;
exports.createEvents = createEvents;
exports.setPreferenceMinimumMaximum = setPreferenceMinimumMaximum;
