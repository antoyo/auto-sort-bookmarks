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

const { Class } = require('sdk/core/heritage');
const { defer } = require('sdk/core/promise');
const { isRecursivelyExcluded } = require('annotations');
const { Folder, menuFolder, toolbarFolder, unsortedFolder } = require('bookmarks');
const { Thread } = require('thread');

/**
 * Reverse the base of an URL to do a better sorting
 */
function reverseBaseUrl(str) {
    if(!str) {
        return '';
    }
    /* Used code generator: https://regex101.com/ */
    str = str.replace(/^\S+:\/\//, '');
    let re = /^[^\/]+$|^[^\/]+/;
    let m;

    if((m = re.exec(str)) !== null) {
        if(m.index === re.lastIndex) {
            re.lastIndex++;
        }
        // Replace the found string by it's reversion
        str = str.replace(m[0], m[0].split('.').reverse().join('.'));
    }

    return str;
}

/**
 * Bookmark sorter class.
 */
let BookmarkSorter = new Class({
    /**
     * Get a bookmark sorter.
     * @constructor
     */
    initialize: function() {
    },
    /**
     * Create a bookmark comparator.
     */
    createCompare: function() {
        let comparator;

        function checkCorruptedAndOrder(bookmark1, bookmark2) {
            if(bookmark1.corrupted) {
                if(bookmark2.corrupted) {
                    return 0;
                }

                return 1;
            }
            else if(bookmark2.corrupted) {
                return -1;
            }

            if(bookmark1.order !== bookmark2.order) {
                return bookmark1.order - bookmark2.order;
            }
        }

        function addReverseUrls(bookmark1, bookmark2, criteria) {
            if(criteria === 'revurl') {
                bookmark1.revurl = reverseBaseUrl(bookmark1.url);
                bookmark2.revurl = reverseBaseUrl(bookmark2.url);
            }
        }

        let compareOptions = {
            caseFirst: 'upper',
            numeric: true,
            sensitivity: 'case',
        };

        if(BookmarkSorter.prototype.caseInsensitive) {
            compareOptions.sensitivity = 'base';
        }

        let firstComparator;
        if(['title', 'url', 'revurl', 'description', 'keyword'].indexOf(BookmarkSorter.prototype.firstSortCriteria) !== -1) {
            firstComparator = function(bookmark1, bookmark2) {
                addReverseUrls(bookmark1, bookmark2, BookmarkSorter.prototype.firstSortCriteria);
                return bookmark1[BookmarkSorter.prototype.firstSortCriteria].localeCompare(bookmark2[BookmarkSorter.prototype.firstSortCriteria], undefined, compareOptions) * BookmarkSorter.prototype.firstReverse;
            };
        }
        else {
            firstComparator = function(bookmark1, bookmark2) {
                return (bookmark1[BookmarkSorter.prototype.firstSortCriteria] - bookmark2[BookmarkSorter.prototype.firstSortCriteria]) * BookmarkSorter.prototype.firstReverse;
            };
        }

        let secondComparator;
        if(BookmarkSorter.prototype.secondSortCriteria !== undefined) {
            if(['title', 'url', 'revurl', 'description', 'keyword'].indexOf(BookmarkSorter.prototype.secondSortCriteria) !== -1) {
                secondComparator = function(bookmark1, bookmark2) {
                    addReverseUrls(bookmark1, bookmark2, BookmarkSorter.prototype.secondSortCriteria);
                    return bookmark1[BookmarkSorter.prototype.secondSortCriteria].localeCompare(bookmark2[BookmarkSorter.prototype.secondSortCriteria], undefined, compareOptions) * BookmarkSorter.prototype.secondReverse;
                };
            }
            else {
                secondComparator = function(bookmark1, bookmark2) {
                    return (bookmark1[BookmarkSorter.prototype.secondSortCriteria] - bookmark2[BookmarkSorter.prototype.secondSortCriteria]) * BookmarkSorter.prototype.secondReverse;
                };
            }
        }
        else {
            secondComparator = function() {
                return 0;
            };
        }

        let itemComparator = function(bookmark1, bookmark2) {
            return firstComparator(bookmark1, bookmark2) || secondComparator(bookmark1, bookmark2);
        };

        if(BookmarkSorter.prototype.differentFolderOrder) {
            if(BookmarkSorter.prototype.folderSortCriteria !== undefined) {
                comparator = function(bookmark1, bookmark2) {
                    if(bookmark1 instanceof Folder && bookmark2 instanceof Folder) {
                        if(['title', 'description'].indexOf(BookmarkSorter.prototype.folderSortCriteria) !== -1) {
                            return bookmark1[BookmarkSorter.prototype.folderSortCriteria].localeCompare(bookmark2[BookmarkSorter.prototype.folderSortCriteria], undefined, compareOptions) * BookmarkSorter.prototype.folderReverse;
                        }

                        return (bookmark1[BookmarkSorter.prototype.folderSortCriteria] - bookmark2[BookmarkSorter.prototype.folderSortCriteria]) * BookmarkSorter.prototype.folderReverse;
                    }

                    return itemComparator(bookmark1, bookmark2);
                };
            }
            else {
                comparator = function(bookmark1, bookmark2) {
                    if(bookmark1 instanceof Folder && bookmark2 instanceof Folder) {
                        return 0;
                    }

                    return itemComparator(bookmark1, bookmark2);
                };
            }
        }
        else {
            comparator = itemComparator;
        }

        return function(bookmark1, bookmark2) {
            let result = checkCorruptedAndOrder(bookmark1, bookmark2);
            if(result === undefined) {
                return comparator(bookmark1, bookmark2);
            }

            return result;
        };
    },

    foldersToSort: [],
    /**
     * Get all the folders as a flat list.
     * @return {Array.<Folder>} The folders.
     */
    getAllFolders: function() {
        let folders = [];

        if(!isRecursivelyExcluded(menuFolder.id)) {
            folders.push(menuFolder);
            yield menuFolder;
        }

        if(!isRecursivelyExcluded(toolbarFolder.id)) {
            folders.push(toolbarFolder);
            yield toolbarFolder;
        }

        if(!isRecursivelyExcluded(unsortedFolder.id)) {
            folders.push(unsortedFolder);
            yield unsortedFolder;
        }

        for(let i = 0, length = folders.length ; i < length ; ++i) {
            for(let folder of folders[i].getFolders()) {
                yield folder;
            }
        }
    },

    isSorting: false,
    /**
     * Check if `folderToCheck` is about to be sorted.
     * @param {Folder} folderToCheck The folder to check.
     * @return {boolean} Whether the folder is about to be sorted or not.
     */
    isToBeSorted: function(folderToCheck) {
        for(let folder of this.foldersToSort) {
            if(folderToCheck.id === folder.id) {
                return true;
            }
        }

        return false;
    },
    /**
     * Set the sort criteria.
     * @param {string} firstSortCriteria The first sort criteria attribute.
     * @param {boolean} firstReverse Whether the first sort is reversed.
     * @param {string} secondReverse The second sort criteria attribute.
     * @param {boolean} secondReverse Whether the second sort is reversed.
     */
    setCriteria: function(firstSortCriteria, firstReverse, secondSortCriteria, secondReverse, folderSortCriteria, folderReverse, differentFolderOrder, caseInsensitive) {
        BookmarkSorter.prototype.firstReverse = firstReverse ? -1 : 1;
        BookmarkSorter.prototype.firstSortCriteria = firstSortCriteria;
        BookmarkSorter.prototype.secondReverse = secondReverse ? -1 : 1;
        BookmarkSorter.prototype.secondSortCriteria = secondSortCriteria;
        BookmarkSorter.prototype.folderReverse = folderReverse ? -1 : 1;
        BookmarkSorter.prototype.folderSortCriteria = folderSortCriteria;
        BookmarkSorter.prototype.differentFolderOrder = differentFolderOrder;
        BookmarkSorter.prototype.caseInsensitive = caseInsensitive;
        this.compare = this.createCompare();
    },
    /**
     * Generator sorting all bookmarks.
     */
    sortAllBookmarks: function() {
        return this.sortFolders(this.getAllFolders());
    },
    /**
     * Generator sorting and saving a folder.
     * @param {Folder} folder The folder to sort and save.
     */
    sortAndSave: function(folder) {
        if(folder.canBeSorted()) {
            this.sortFolder(folder);

            yield true;
            for(let result of folder.save()) {
                yield result;
            }
        }
    },
    /**
     * Sort the `folder` children.
     * @param {Folder} folder The folder to sort.
     */
    sortFolder: function(folder) {
        folder.getChildren();

        let delta = 0;
        let length;

        for(let i = 0 ; i < folder.children.length ; ++i) {
            folder.children[i].sort(this.compare);
            length = folder.children[i].length;
            for(let j = 0 ; j < length ; ++j) {
                folder.children[i][j].setIndex(j + delta);
            }

            delta += length + 1;
        }
    },
    /**
     * Sort the `folders`.
     * @param {Array.<Folder>|Folder} folders The folders to sort.
     * @param {int} time The time before sorting in milliseconds.
     */
    sortFolders: function(folders, time) {
        let deferred = defer();

        folders = folders instanceof Folder ? [folders] : folders;
        time = time !== undefined ? time : 0;

        if(this.isSorting) {
            this.sortLater(folders);
        }
        else {
            let self = this;

            this.thread = new Thread(function() {
                if(self.isSorting) {
                    self.sortLater(folders);
                    yield false;
                }

                self.isSorting = true;

                yield true;

                for(let folder of folders) {
                    for(let result of self.sortAndSave(folder)) {
                        yield result;
                    }
                }

                while(self.foldersToSort.length > 0) {
                    for(let result of self.sortAndSave(self.foldersToSort[0])) {
                        yield result;
                    }
                    self.foldersToSort.splice(0, 1);
                }

                self.isSorting = false;

                deferred.resolve();

                yield false;
            }, time);
        }

        return deferred.promise;
    },
    /**
     * Sort `folders` later.
     * @param {Array.<Folder>|Folder} folders The folders to sort later.
     */
    sortLater: function(folders) {
        for(let folder of folders) {
            if(!this.isToBeSorted(folder) && folder.canBeSorted()) {
                this.foldersToSort.push(folder);
            }
        }
    },
    /**
     * Start the sorting thread.
     */
    start: function() {
        if(this.isSorting) {
            this.thread.start();
        }
    },
    /**
     * Stop the sorting thread.
     */
    stop: function() {
        if(this.thread) {
            this.thread.stop();
        }
    },

    thread: null,
});

exports.BookmarkSorter = BookmarkSorter;
