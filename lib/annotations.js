/*
 * Copyright (C) 2014  Boucher, Antoni <bouanto@zoho.com>
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

const { Cc, Ci } = require('chrome');
const annotationService = Cc['@mozilla.org/browser/annotation-service;1'].getService(Ci.nsIAnnotationService);
const descriptionAnnotation = 'bookmarkProperties/description';
const livemarkAnnotation = 'livemark/siteURI';
const smartBookmarkAnnotation = 'Places/SmartBookmark';

/**
 * Get the item description.
 * @param {int} itemID The item ID.
 * @return {string} The item description.
 */
function getDescription(item) {
    let description;
    try {
        description = annotationService.getItemAnnotation(item.id, descriptionAnnotation);
    }
    catch(exception) {
        description = '';
    }

    return description;
}

/**
 * Get an item annotation.
 */
function getItemAnnotation(itemID, name) {
    let annotation;
    try {
        annotation = annotationService.getItemAnnotation(itemID, name);
    }
    catch(exception) {
        // Do nothing.
    }

    return annotation;
}

/**
 * Check if an item has a do not sort annotation.
 */
function hasDoNotSortAnnotation(itemID) {
    let annotation = getItemAnnotation(itemID, 'autosortbookmarks/donotsort');
    return annotation !== undefined;
}

/**
 * Check if an item has a recursive annotation.
 */
function hasRecursiveAnnotation(itemID) {
    let annotation = getItemAnnotation(itemID, 'autosortbookmarks/recursive');
    return annotation !== undefined;
}

/**
 * Check if an item is recursively excluded.
 */
function isRecursivelyExcluded(itemID) {
    return hasDoNotSortAnnotation(itemID) && hasRecursiveAnnotation(itemID);
}

/**
 * Check whether `itemID` is a livemark.
 * @param {int} itemID The item ID.
 * @return {boolean} Whether the item is a livemark or not.
 */
function isLivemark(itemID) {
    return annotationService.itemHasAnnotation(itemID, livemarkAnnotation);
}

/**
 * Check whether `itemID` is a smart bookmark.
 * @param {int} itemID The item ID.
 * @return {boolean} Whether the item is a smart bookmark or not.
 */
function isSmartBookmark(itemID) {
    return annotationService.itemHasAnnotation(itemID, smartBookmarkAnnotation);
}

/**
 * Remove an item annotation.
 */
function removeItemAnnotation(itemID, name) {
    annotationService.removeItemAnnotation(itemID, name);
}

/**
 * Remove the do not sort annotation on an item.
 */
function removeDoNotSortAnnotation(itemID) {
    removeItemAnnotation(itemID, 'autosortbookmarks/donotsort');
}

/**
 * Remove the recursive annotation on an item.
 */
function removeRecursiveAnnotation(itemID) {
    removeItemAnnotation(itemID, 'autosortbookmarks/recursive');
}

/**
 * Set an item annotation.
 */
function setItemAnnotation(itemID, name, value) {
    const { bookmarkExists } = require('bookmarks');
    if(bookmarkExists(itemID)) {
        annotationService.setItemAnnotation(itemID, name, value, 0, annotationService.EXPIRE_NEVER);
    }
}

/**
 * Set the do not sort annotation on an item.
 */
function setDoNotSortAnnotation(itemID) {
    setItemAnnotation(itemID, 'autosortbookmarks/donotsort', true);
}

/**
 * Set the recursive annotation on an item.
 */
function setRecursiveAnnotation(itemID) {
    setItemAnnotation(itemID, 'autosortbookmarks/recursive', true);
}

exports.getDescription = getDescription;
exports.getItemAnnotation = getItemAnnotation;
exports.hasDoNotSortAnnotation = hasDoNotSortAnnotation;
exports.hasRecursiveAnnotation = hasRecursiveAnnotation;
exports.isRecursivelyExcluded = isRecursivelyExcluded;
exports.isLivemark = isLivemark;
exports.isSmartBookmark = isSmartBookmark;
exports.removeItemAnnotation = removeItemAnnotation;
exports.removeDoNotSortAnnotation = removeDoNotSortAnnotation;
exports.removeRecursiveAnnotation = removeRecursiveAnnotation;
exports.setItemAnnotation = setItemAnnotation;
exports.setDoNotSortAnnotation = setDoNotSortAnnotation;
exports.setRecursiveAnnotation = setRecursiveAnnotation;
