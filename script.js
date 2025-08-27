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

// --- Utility Functions ---

/**
 * Parses the M3U text content into an array of channel objects.
 * This function is enhanced to look for common attributes like tvg-id, tvg-logo, group-title.
 * @param {string} m3uText - The raw M3U playlist content.
 * @returns {Array<Object>} An array of channel objects.
 */
function parseM3U(m3uText) {
    const channels = [];
    const lines = m3uText.split('\n');
    let currentChannel = null;

    // Regex to capture standard M3U attributes from #EXTINF lines.
    // It captures keys like 'tvg-id', 'tvg-name', 'tvg-logo', 'group-title', etc.
    // Example: #EXTINF:-1 tvg-id="channel1" tvg-name="Channel One" tvg-logo="http://example.com/logo.png" group-title="News",Channel One SD
    const attributeRegex = /#EXTINF:-?\d+ ?(?:([^,]+))?,?(.*)/; // Captures attributes string and title string separately
    const attributeValueRegex = /([\w-]+)\s*=\s*"([^"]*)"/g; // Captures key="value" pairs within attributes

    for (const line of lines) {
        if (line.trim() === '' || line.startsWith('#EXTM3U')) {
            continue; // Skip empty lines or the main M3U header
        }

        if (line.startsWith('#EXTINF')) {
            currentChannel = {
                title: '',
                streamUrl: '',
                logo: null,
                groupTitle: 'Uncategorized',
                tvgId: null, // Explicitly store tvg-id
                rawAttributes: {} // To store all parsed attributes
            };

            const extinfMatch = line.match(attributeRegex);
            if (extinfMatch) {
                const attributesString = extinfMatch[1]; // String containing all key="value" pairs
                const titleString = extinfMatch[2] ? extinfMatch[2].trim() : ''; // The title after the last comma

                // Parse attributes string
                let attrMatch;
                while ((attrMatch = attributeValueRegex.exec(attributesString)) !== null) {
                    const key = attrMatch[1].toLowerCase(); // Normalize keys like 'tvg-id', 'tvg-logo'
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
                // Fallback for title if tvg-name was not found
                if (!currentChannel.title) {
                    currentChannel.title = titleString;
                }
            } else {
                // Handle cases where EXTINF might be simpler without attributes
                const titleMatch = line.match(/#EXTINF:-?\d+,?(.*)/);
                if (titleMatch && titleMatch[1]) {
                    currentChannel.title = titleMatch[1].trim();
                }
            }

        } else if (line.startsWith('http') && currentChannel) {
            // This line is the stream URL
            currentChannel.streamUrl = line.trim();
            
            // Basic validation for stream URL
            if (currentChannel.streamUrl && (currentChannel.streamUrl.startsWith('http://') || currentChannel.streamUrl.startsWith('https://'))) {
                // Add the fully parsed channel to the list
                channels.push(currentChannel);
            } else {
                console.warn(`Skipping invalid stream URL for channel "${currentChannel.title}": ${currentChannel.streamUrl}`);
            }
            currentChannel = null; // Reset for the next channel
        }
    }
    return channels;
}

/**
 * Fetches M3U data from the specified URL.
 * Handles potential CORS issues if not served by a web server.
 */
async function fetchM3UData() {
    try {
        // Use fetch API to get the M3U content.
        // Browsers may block this request if the server (allinonereborn.fun)
        // does not send the correct CORS headers (Access-Control-Allow-Origin).
        // This is why running locally with `npx serve` or deploying is crucial.
        const response = await fetch(M3U_URL);
        if (!response.ok) {
            // If response is not ok (e.g., 404, 500), throw an error.
            throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
        }
        const m3uText = await response.text();
        
        // Check if the response actually contains M3U data or an error message
        if (m3uText.startsWith('#EXTM3U') || m3uText.includes('#EXTINF')) {
            allChannels = parseM3U(m3uText);
            filteredChannels = [...allChannels]; // Initialize filtered list
            renderChannels(filteredChannels);
            populateCategoryFilter();
            console.log(`Successfully loaded ${allChannels.length} channels.`);
        } else {
            // The response might be an HTML page or an error message from the server
            console.error('Received non-M3U content:', m3uText.substring(0, 200) + '...'); // Log first 200 chars
            throw new Error('Server returned content that is not a valid M3U playlist.');
        }
    } catch (error) {
        console.error('Failed to fetch or parse M3U data:', error);
        // Display a user-friendly error message on the page
        channelGridContainer.innerHTML = `
            <div class="col-12 text-center text-danger p-4">
                <h2>Error Loading Channels</h2>
                <p>${error.message}</p>
                <p>Please ensure the M3U URL is correct and accessible.</p>
                <p>If running locally, make sure you are using a web server (like `npx serve`).</p>
            </div>
        `;
        // Clear categories if loading failed
        categoryFilter.innerHTML = '<option value="all">All Categories</option>';
    }
}


/**
 * Renders the channel cards into the specified container.
 * @param {Array<Object>} channelsToRender - The array of channel objects to display.
 * @param {HTMLElement} container - The DOM element where the cards should be rendered.
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
        // Using Bootstrap classes for grid layout
        // col-xs-6 (small screens) for 2 columns, col-md-3 (medium screens) for 4 columns
        cardElement.className = 'channel-card col-6 col-sm-4 col-md-3 col-lg-2 mb-3'; 
        cardElement.dataset.title = channel.title; // Store title for easier access
        // Use tvgId if available, otherwise title for favorite lookup.
        // If title contains special chars, tvgId might be more reliable.
        // For simplicity, we'll use title as per previous logic.
        // const favoriteKey = channel.tvgId || channel.title; 

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
        // Use a single listener that targets the interactive parts
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

            // If currently viewing favorites, refresh the favorite list
            if (!favoritesSection.classList.contains('d-none')) {
                renderFavorites(); // Re-render favorites to ensure consistency
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
 * Populates the category filter dropdown.
 */
function populateCategoryFilter() {
    const categories = new Set(['All Categories']); // Start with "All Categories"
    allChannels.forEach(channel => {
        if (channel.groupTitle) {
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
        return;
    }

    if (!clapprPlayer) {
        // Initialize Clappr player if it doesn't exist
        clapprPlayer = new Clappr.Player({
            source: channel.streamUrl,
            parentId: 'player-container',
            width: '100%',
            height: '100%',
            autoPlay: true,
            // Specify mimeType, usually application/x-mpegURL for HLS streams common in IPTV
            // If your stream is different (e.g., MP4, TS), you might need to adjust this or remove it.
            mimeType: 'application/x-mpegURL', 
            // Minimalist UI for better experience - uncomment/adjust as needed
            // ui: {
            //     disableSeekbar: false, 
            //     disableVolume: false, 
            //     disablePlaybackRates: false,
            //     disableFullscreen: false,
            //     disableTimer: false,
            // },
            // Add plugins here if you have them, e.g., for quality selection.
            // For quality selection, a plugin like `LevelSelector` might be needed,
            // and it relies on the stream providing quality level information.
            // plugins: [LevelSelector] // Assuming LevelSelector is defined later
        });
        
        // If player fails to initialize, log it and show an error to user
        clapprPlayer.on(Clappr.Events.PLAYER_ERROR, function(error) {
            console.error("Clappr Player Error:", error);
            // Optionally show a message to the user in the player area
            if (playerSection.classList.contains('d-none')) { // Only if we're about to show it
                playerSection.classList.remove('d-none');
            }
            document.getElementById('player-container').innerHTML = `<div class="text-center text-danger p-5">
                <h3>Error loading stream</h3>
                <p>${channel.title}</p>
                <p>The stream might be unavailable or in an unsupported format.</p>
                </div>`;
            clapprPlayer = null; // Reset player so it can be re-initialized
        });

    } else {
        // Update the source of the existing player
        clapprPlayer.load(channel.streamUrl, { mimeType: 'application/x-mpegURL' });
    }
    currentStreamUrl = channel.streamUrl; // Keep track of current stream

    // Show player section and hide other sections
    playerSection.classList.remove('d-none');
    channelsSection.classList.add('d-none');
    favoritesSection.classList.add('d-none'); 
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
    
    // Re-render channels to update favorite icons on the main grid if it's visible
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

    // Filter allChannels array
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

// --- Initial Load ---
// Ensure the DOM is fully loaded before trying to access elements or fetch data
document.addEventListener('DOMContentLoaded', () => {
    fetchM3UData(); // Load channels when the page is ready
});

// --- Optional: Clappr Level Selector Plugin ---
// Note: Clappr's built-in HLS playback engine might automatically handle quality.
// If you need manual selection, you'd typically use a plugin.
// The following is a placeholder or basic example. Actual implementation
// depends on how Clappr's engine exposes stream levels.
/*
class LevelSelector extends Clappr.CorePlugin {
    get name() { return 'level_selector'; }

    bindEvents() {
        // Listen for when the media control bar is shown to potentially add selector
        this.listenTo(this.core.mediaControl, Clappr.Events.MEDIA_CONTROL_SHOW, this.showLevelSelector);
        // Listen for when the source changes
        this.listenTo(this.core.activeContainer, Clappr.Events.PLAYER_CONTAINER_WILL_CHANGE_SOURCE, this.resetLevelSelector);
    }

    showLevelSelector() {
        // Check if the player has exposed levels and controls are visible
        const levels = this.player.getPlayableLevels(); // This method might need to be implemented or found in Clappr's HLS engine
        if (levels && levels.length > 1 && this.core.mediaControl.is.visible()) {
            if (!this.selectorContainer) {
                this.selectorContainer = document.createElement('div');
                this.selectorContainer.className = 'clappr-quality-selector'; // Custom class for styling
                this.core.mediaControl.add(this.selectorContainer); // Add to media control bar
            }

            // Populate the select element with quality levels
            this.selectorContainer.innerHTML = `
                <select class="clappr-quality-select form-select form-select-sm">
                    ${levels.map(level => 
                        `<option value="${level.id}" ${level.current ? 'selected' : ''}>
                            ${level.name || `Level ${level.id}`}
                        </option>`
                    ).join('')}
                </select>
            `;

            // Add event listener to the select element
            this.selectorContainer.querySelector('select').addEventListener('change', (e) => {
                const selectedLevelId = parseInt(e.target.value, 10);
                this.player.setCurrentQualityLevel(selectedLevelId); // Method to set quality level
            });
            this.selectorContainer.style.display = 'block'; // Ensure it's visible
        } else {
            this.hideLevelSelector(); // Hide if no levels or controls are hidden
        }
    }

    hideLevelSelector() {
        if (this.selectorContainer) {
            this.selectorContainer.style.display = 'none';
        }
    }
    
    resetLevelSelector() {
        // Clean up old selector or reset its state when source changes
        if (this.selectorContainer) {
            this.selectorContainer.style.display = 'none';
            this.selectorContainer.innerHTML = ''; // Clear content
        }
    }
}
*/
