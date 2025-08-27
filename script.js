// script.js

// --- Configuration ---
// Your M3U playlist URL. This is treated as an API endpoint returning M3U formatted data.
const M3U_URL = 'https://allinonereborn.fun/playlist/jiotv-ww411.m3u'; 

// --- State Variables ---
let allChannels = []; // Stores all fetched and parsed channel data
let filteredChannels = []; // Stores currently displayed channels (after search/filter)
let favorites = JSON.parse(localStorage.getItem('iptvFavorites')) || []; // Favorites stored in localStorage

let clapprPlayer = null; // Clappr player instance
let currentStreamUrl = null; // The URL currently loaded in the player

// --- DOM Elements ---
const searchInput = document.getElementById('search-input');
const categoryFilter = document.getElementById('category-filter');
const showFavoritesBtn = document.getElementById('show-favorites-btn');
const channelsSection = document.getElementById('channels-section');
const favoritesSection = document.getElementById('favorites-section');
const playerSection = document.getElementById('player-section');
const channelGridContainer = document.querySelector('.channel-grid');
const favoriteChannelGridContainer = document.querySelector('.favorite-channel-grid');
const pageMessageContainer = document.createElement('div'); // For displaying general messages on the page

// --- Initialization and DOM Setup ---
document.addEventListener('DOMContentLoaded', () => {
    // Setup page message container
    pageMessageContainer.id = 'page-message';
    pageMessageContainer.className = 'alert alert-warning text-center mb-4';
    pageMessageContainer.style.display = 'none'; // Hidden by default
    document.querySelector('.container-fluid').prepend(pageMessageContainer); // Add message container at the top

    fetchM3UData(); // Load channels when the page is ready
});

// --- Utility Functions ---

/**
 * Displays a message to the user on the page.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'info', 'warning', 'danger'.
 */
function showPageMessage(message, type = 'info') {
    pageMessageContainer.textContent = message;
    pageMessageContainer.className = `alert alert-${type} text-center mb-4`;
    pageMessageContainer.style.display = 'block';
}

/**
 * Hides any currently displayed page message.
 */
function hidePageMessage() {
    pageMessageContainer.style.display = 'none';
}

/**
 * Parses the M3U text content into an array of channel objects.
 * This function is enhanced to look for common attributes like tvg-id, tvg-logo, group-title, and title.
 * @param {string} m3uText - The raw M3U playlist content.
 * @returns {Array<Object>} An array of channel objects.
 */
function parseM3U(m3uText) {
    const channels = [];
    const lines = m3uText.split('\n');
    let currentChannel = null;

    // Regex to capture EXTINF line content. 
    // It captures attributes string and title string separately.
    // Handles various spacing and presence of attributes.
    const extinfRegex = /#EXTINF:-?\d+(?:\s+(.*?))?,(.*)/;
    // Regex to parse key="value" pairs within the attributes string
    const attributeValueRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#EXTM3U')) {
            continue; // Skip empty lines or the main M3U header
        }

        if (trimmedLine.startsWith('#EXTINF')) {
            currentChannel = {
                title: '',
                streamUrl: '',
                logo: null,
                groupTitle: 'Uncategorized', // Default category
                tvgId: null, // Explicitly store tvg-id
                rawAttributes: {} // To store all parsed attributes
            };

            const extinfMatch = trimmedLine.match(extinfRegex);
            if (extinfMatch) {
                const attributesString = extinfMatch[1] || ''; // String containing all key="value" pairs, or empty if none
                const titleString = extinfMatch[2] ? extinfMatch[2].trim() : ''; // The title after the last comma

                // Parse attributes string
                let attrMatch;
                while ((attrMatch = attributeValueRegex.exec(attributesString)) !== null) {
                    const key = attrMatch[1].toLowerCase(); // Normalize keys to lowercase
                    const value = attrMatch[2];
                    currentChannel.rawAttributes[key] = value;

                    if (key === 'tvg-id') {
                        currentChannel.tvgId = value;
                    }
                    if (key === 'tvg-name') {
                        currentChannel.title = value; // Prioritize tvg-name if available
                    }
                    if (key === 'tvg-logo') {
                        currentChannel.logo = value;
                    }
                    if (key === 'group-title') {
                        currentChannel.groupTitle = value;
                    }
                }
                // Fallback for title if tvg-name was not found or doesn't exist
                if (!currentChannel.title) {
                    currentChannel.title = titleString;
                }
                // If after all that, title is still empty, use a placeholder
                if (!currentChannel.title) {
                    currentChannel.title = 'Untitled Channel';
                }

            } else {
                // If EXTINF line doesn't match expected format, log and skip
                console.warn(`Skipping malformed #EXTINF line: ${trimmedLine}`);
                currentChannel = null; // Reset currentChannel as this line is not valid
                continue;
            }

        } else if (trimmedLine.startsWith('http') && currentChannel) {
            // This line is the stream URL
            currentChannel.streamUrl = trimmedLine;
            
            // Basic validation for stream URL
            if (currentChannel.streamUrl && (currentChannel.streamUrl.startsWith('http://') || currentChannel.streamUrl.startsWith('https://'))) {
                channels.push(currentChannel); // Add the fully parsed channel to the list
            } else {
                console.warn(`Skipping invalid stream URL for channel "${currentChannel.title}": ${currentChannel.streamUrl}`);
            }
            currentChannel = null; // Reset for the next channel entry
        }
    }
    return channels;
}

/**
 * Fetches M3U data from the specified URL.
 * Includes error handling for fetch failures and non-M3U responses.
 */
async function fetchM3UData() {
    hidePageMessage(); // Clear any previous messages
    showPageMessage('Loading channels...', 'info');
    channelGridContainer.innerHTML = ''; // Clear previous grid content
    categoryFilter.innerHTML = '<option value="all">All Categories</option>'; // Reset categories

    try {
        const response = await fetch(M3U_URL);
        
        if (!response.ok) {
            // Handle HTTP errors (404, 500, etc.)
            const errorText = await response.text(); // Try to get error details
            throw new Error(`HTTP Error ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}...`);
        }
        
        const m3uText = await response.text();
        
        // Basic check to see if the response looks like M3U content
        if (!m3uText.startsWith('#EXTM3U') && !m3uText.includes('#EXTINF')) {
            throw new Error('Received content is not a valid M3U playlist. Check the URL or M3U format.');
        }

        allChannels = parseM3U(m3uText);
        filteredChannels = [...allChannels]; // Initialize filtered list with all channels
        
        if (allChannels.length === 0) {
            showPageMessage('No valid channels found in the playlist. Check the M3U source.', 'warning');
            renderChannels(filteredChannels); // Render the empty state
        } else {
            showPageMessage(`Loaded ${allChannels.length} channels.`, 'success');
            renderChannels(filteredChannels);
            populateCategoryFilter();
        }

    } catch (error) {
        console.error('Failed to fetch or parse M3U data:', error);
        showPageMessage(`Error loading channels: ${error.message}`, 'danger');
        // Ensure empty state is rendered if error occurs
        renderChannels([]); 
    }
}

/**
 * Renders the channel cards into the specified container.
 * @param {Array<Object>} channelsToRender - The array of channel objects to display.
 * @param {HTMLElement} container - The DOM element where the cards should be rendered. Defaults to channelGridContainer.
 */
function renderChannels(channelsToRender, container = channelGridContainer) {
    container.innerHTML = ''; // Clear previous channels

    if (channelsToRender.length === 0) {
        container.innerHTML = '<div class="col-12 text-center text-muted p-4">No channels found matching your criteria.</div>';
        return;
    }

    channelsToRender.forEach(channel => {
        const isFavorite = favorites.includes(channel.title);

        const cardElement = document.createElement('div');
        // Bootstrap grid classes for responsiveness: 
        // col-6 (xs, <576px): 2 columns
        // col-sm-4 (sm, ≥576px): 3 columns
        // col-md-3 (md, ≥768px): 4 columns
        // col-lg-2 (lg, ≥992px): 6 columns
        cardElement.className = 'channel-card col-6 col-sm-4 col-md-3 col-lg-2 mb-3'; 
        cardElement.dataset.title = channel.title; // Store title for easier access

        cardElement.innerHTML = `
            <div class="channel-image-wrapper">
                <img src="${channel.logo || 'https://via.placeholder.com/200x150?text=No+Logo'}" class="channel-image" alt="${channel.title} logo">
            </div>
            <div class="channel-name-overlay">${channel.title}</div>
            <button class="favorite-btn" aria-label="Add/Remove from favorites">
                ${isFavorite ? '❤️' : '🤍'}
            </button>
        `;

        // Add event listener for clicking the card (image or name) to play channel
        const cardBody = cardElement.querySelector('.channel-image-wrapper, .channel-name-overlay');
        if (cardBody) {
            cardBody.addEventListener('click', () => {
                playChannel(channel);
            });
        }

        // Add event listener for favorite button
        const favButton = cardElement.querySelector('.favorite-btn');
        favButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click event from firing
            toggleFavorite(channel.title); // Use title for favorite management

            // Update button appearance immediately
            const btn = e.currentTarget;
            btn.innerHTML = favorites.includes(channel.title) ? '❤️' : '🤍';
            btn.classList.toggle('favorited', favorites.includes(channel.title));

            // If currently viewing favorites, re-render favorites to ensure consistency
            if (!favoritesSection.classList.contains('d-none')) {
                renderFavorites();
            }
        });
        
        // Set initial favorite button state (heart icon)
        if (isFavorite) {
            favButton.classList.add('favorited');
        }

        container.appendChild(cardElement);
    });
}

/**
 * Populates the category filter dropdown with unique group titles from channels.
 */
function populateCategoryFilter() {
    const categories = new Set(['All Categories']); // Start with "All Categories"
    allChannels.forEach(channel => {
        if (channel.groupTitle && channel.groupTitle !== 'Uncategorized') { // Don't list 'Uncategorized' if it's the only one
            categories.add(channel.groupTitle);
        }
    });

    const sortedCategories = Array.from(categories).sort(); // Sort alphabetically

    categoryFilter.innerHTML = ''; // Clear existing options
    sortedCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categoryFilter.appendChild(option);
    });
}

/**
 * Plays a selected channel in the Clappr player.
 * @param {Object} channel - The channel object to play.
 */
function playChannel(channel) {
    if (!channel || !channel.streamUrl) {
        console.error("Attempted to play an invalid channel or channel without a stream URL.");
        showPageMessage("Selected channel has no valid stream URL.", "danger");
        return;
    }

    // Hide other sections and show player section
    hidePageMessage();
    channelsSection.classList.add('d-none');
    favoritesSection.classList.add('d-none');
    playerSection.classList.remove('d-none');

    if (!clapprPlayer) {
        // Initialize Clappr player if it doesn't exist
        clapprPlayer = new Clappr.Player({
            source: channel.streamUrl,
            parentId: 'player-container',
            width: '100%',
            height: '100%',
            autoPlay: true,
            mimeType: 'application/x-mpegURL', // Common for HLS IPTV streams
            events: {
                onPlayerError: handlePlayerError // Attach custom error handler
            }
        });
    } else {
        // Update the source of the existing player
        clapprPlayer.load(channel.streamUrl, { mimeType: 'application/x-mpegURL' });
    }
    currentStreamUrl = channel.streamUrl; // Keep track of current stream
}

/**
 * Handles errors occurring within the Clappr player.
 * @param {Object} error - The error object from Clappr.
 */
function handlePlayerError(error) {
    console.error("Clappr Player Error:", error);
    let errorMessage = "Error loading stream.";
    if (error && error.message) {
        errorMessage = `Stream Error: ${error.message}`;
    }
    // Display error message in the player container
    document.getElementById('player-container').innerHTML = `<div class="text-center text-danger p-5">
        <h3>${errorMessage}</h3>
        <p>The stream might be unavailable, in an unsupported format, or require a specific player setup.</p>
        <button class="btn btn-outline-danger mt-3" onclick="window.location.reload();">Try Reloading</button>
    </div>`;
    // Optionally reset player if it's in a bad state
    // clapprPlayer = null; // Consider resetting if needed, but it might prevent retries on the same stream
}

/**
 * Toggles a channel's favorite status using its title.
 * @param {string} channelTitle - The title of the channel to toggle.
 */
function toggleFavorite(channelTitle) {
    const index = favorites.indexOf(channelTitle);
    if (index === -1) {
        // Add to favorites
        favorites.push(channelTitle);
    } else {
        // Remove from favorites
        favorites.splice(index, 1);
    }
    localStorage.setItem('iptvFavorites', JSON.stringify(favorites));
    
    // Re-render channels to update favorite icons if the main channel grid is visible
    if (!channelsSection.classList.contains('d-none')) {
        renderChannels(filteredChannels); 
    }
    // If viewing favorites, re-render favorites too to remove if unfavorited
    if (!favoritesSection.classList.contains('d-none')) {
        renderFavorites();
    }
}

/**
 * Filters channels based on search term and selected category.
 * Updates the display and keeps track of the `filteredChannels` array.
 */
function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase();
    const selectedCategory = categoryFilter.value;

    // Filter allChannels array based on search and category
    filteredChannels = allChannels.filter(channel => {
        const matchesSearch = channel.title.toLowerCase().includes(searchTerm);
        const matchesCategory = selectedCategory === 'all' || channel.groupTitle === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    renderChannels(filteredChannels); // Render the newly filtered list
}

/**
 * Renders only the favorite channels.
 */
function renderFavorites() {
    // Get only channels that are in our favorites list by title
    const favoriteChannelsData = allChannels.filter(channel => favorites.includes(channel.title));
    renderChannels(favoriteChannelsData, favoriteChannelGridContainer);
    
    // Show/Hide sections to display favorites and hide others
    channelsSection.classList.add('d-none');
    playerSection.classList.add('d-none'); // Hide player when switching to favorites
    favoritesSection.classList.remove('d-none');
    
    // Update the button text to indicate how to switch back
    showFavoritesBtn.textContent = 'Show All Channels';
}

// --- Event Listeners ---

// Search input event: Re-apply filters whenever the search input changes
searchInput.addEventListener('input', applyFilters);

// Category filter change event: Re-apply filters when category selection changes
categoryFilter.addEventListener('change', applyFilters);

// Show/Hide Favorites button click event
showFavoritesBtn.addEventListener('click', () => {
    const isFavoritesVisible = !favoritesSection.classList.contains('d-none');
    
    // Hide player and channel sections first
    playerSection.classList.add('d-none');
    channelsSection.classList.add('d-none');
    hidePageMessage(); // Clear any loading messages

    if (!isFavoritesVisible) {
        // If favorites are not visible, show them
        renderFavorites();
    } else {
        // If favorites are visible, hide them and show all channels again
        favoritesSection.classList.add('d-none');
        showFavoritesBtn.textContent = 'Show Favorites'; // Reset button text
        applyFilters(); // Re-apply current search/category filters to show all channels
    }
});

// --- Optional: Clappr Level Selector Plugin Placeholder ---
// If you have a Clappr LevelSelector plugin and want to integrate it,
// you would typically import or define it here and pass it in the Player options:
// plugins: [LevelSelectorPlugin],
// And ensure the stream provides quality level data that Clappr can read.
// For now, Clappr's default HLS handling might auto-select quality if available.

