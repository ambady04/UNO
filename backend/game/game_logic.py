import random
import time

# Card Representation:
# Colors: 'R' (Red), 'Y' (Yellow), 'G' (Green), 'B' (Blue)
# Numbers: '0'-'9'
# Action Cards: 'Skip', 'Reverse', 'Draw2'
# Wild Cards: 'Wild', 'WildDraw4' (Color initially 'W')
# Formats: 'R_0', 'B_Skip', 'W_Wild', 'W_WildDraw4'

def create_initial_deck():
    colors = ['R', 'Y', 'G', 'B']
    deck = []
    
    # Number cards
    for color in colors:
        deck.append(f"{color}_0")
        for num in range(1, 10):
            deck.append(f"{color}_{num}")
            deck.append(f"{color}_{num}")
            
    # Action cards
    for color in colors:
        for action in ['Skip', 'Reverse', 'Draw2']:
            deck.append(f"{color}_{action}")
            deck.append(f"{color}_{action}")
            
    # Wild cards
    for _ in range(4):
        deck.append("W_Wild")
        deck.append("W_WildDraw4")
        
    return deck

def parse_card(card_str):
    parts = card_str.split('_')
    return parts[0], parts[1]

def is_playable(card_str, current_color, current_value, draw_penalty=0, has_drawn_this_turn=False):
    card_color, card_value = parse_card(card_str)
    
    if draw_penalty > 0:
        if has_drawn_this_turn:
            return False
        if current_value == 'Draw2':
            return card_value == 'Draw2'
        elif current_value == 'WildDraw4':
            return card_value == 'WildDraw4'
        return False
        
    # Cannot play +4 (WildDraw4) over +2 (Draw2)
    if card_value == 'WildDraw4' and current_value == 'Draw2':
        return False
        
    # Cannot play +2 (Draw2) over +4 (WildDraw4)
    if card_value == 'Draw2' and current_value == 'WildDraw4':
        return False

    # Wild cards can always be played
    if card_color == 'W':
        return True
        
    # Same color or same value
    if card_color == current_color or card_value == current_value:
        return True
        
    return False

def check_deck_integrity(state):
    """
    Validates that the total number of cards in the deck, discard pile, 
    and all player hands is exactly 108.
    """
    if state.get('game_status') == 'LOBBY':
        return
    total_in_hands = sum(len(hand) for hand in state['hands'].values())
    total = len(state['deck']) + len(state['discard_pile']) + total_in_hands
    assert total == 108, f"Card duplication or loss detected! Total cards = {total} (expected 108)"

def advance_turn(state, step=1):
    num_players = len(state['players'])
    direction = state['direction']
    state['current_turn'] = (state['current_turn'] + (direction * step)) % num_players
    state['turn_started_at'] = time.time()

def reshuffle_discard_pile(state):
    """
    Reshuffle all cards from the discard pile (except the top card) 
    back into the deck when the deck is empty.
    """
    if len(state['discard_pile']) <= 1:
        return # Cannot reshuffle if nothing else is in discard
        
    top_card = state['discard_pile'].pop()
    shuffled_cards = state['discard_pile']
    random.shuffle(shuffled_cards)
    
    state['deck'] = shuffled_cards
    state['discard_pile'] = [top_card]
    
    # Ensure color/value matches top card
    color, value = parse_card(top_card)
    if color != 'W':
        state['current_color'] = color
    state['current_value'] = value

def draw_cards_for_player(state, player_id, count):
    drawn = []
    for _ in range(count):
        if not state['deck']:
            reshuffle_discard_pile(state)
        if state['deck']:
            card = state['deck'].pop()
            state['hands'][player_id].append(card)
            drawn.append(card)
    return drawn

def initialize_game(players):
    """
    Initializes a new game state for the room.
    players: list of dicts {"id": str, "name": str}
    """
    deck = create_initial_deck()
    random.shuffle(deck)
    
    hands = {}
    players_list = []
    for p in players:
        hands[p['id']] = []
        players_list.append({
            'id': p['id'],
            'name': p['name'],
            'is_connected': True,
            'called_uno': False
        })
        
    state = {
        'game_status': 'PLAYING',
        'version': 1,
        'current_turn': 0,
        'direction': 1,
        'deck': deck,
        'discard_pile': [],
        'current_color': '',
        'current_value': '',
        'draw_penalty': 0,
        'turn_started_at': time.time(),
        'players': players_list,
        'hands': hands
    }
    
    # Deal 7 cards to each player
    for pid in hands:
        draw_cards_for_player(state, pid, 7)
        
    # Draw starting card to discard pile (must be colored, non-wild)
    while True:
        start_card = state['deck'].pop()
        card_color, card_value = parse_card(start_card)
        if card_color != 'W':
            state['discard_pile'].append(start_card)
            state['current_color'] = card_color
            state['current_value'] = card_value
            break
        else:
            # Put back wild card and reshuffle
            state['deck'].append(start_card)
            random.shuffle(state['deck'])
            
    # Handle starting card actions
    # Skip
    if card_value == 'Skip':
        advance_turn(state, step=1)
    # Reverse
    elif card_value == 'Reverse':
        if len(state['players']) == 2:
            # In 2-player game, reverse acts as a Skip
            advance_turn(state, step=1)
        else:
            state['direction'] = -1
            # Current turn remains index 0, but play moves counter-clockwise.
            # No skip needed, index 0 plays first.
    # Draw 2
    elif card_value == 'Draw2':
        state['draw_penalty'] = 2
        
    check_deck_integrity(state)
    return state

def handle_play_card(state, player_id, card, chosen_color=None):
    """
    Applies standard UNO logic for playing a card.
    """
    # 1. Validate Turn
    active_player = state['players'][state['current_turn']]
    if active_player['id'] != player_id:
        raise ValueError("It is not your turn.")
        
    # 2. Validate Card Presence in Hand
    player_hand = state['hands'].get(player_id, [])
    if card not in player_hand:
        raise ValueError(f"Card {card} not in your hand.")
        
    # 3. Validate Playability
    if not is_playable(card, state['current_color'], state['current_value'], state.get('draw_penalty', 0), state.get('has_drawn_this_turn', False)):
        raise ValueError(f"Card {card} is not playable on {state['current_color']} {state['current_value']}.")
        
    card_color, card_value = parse_card(card)
    
    # Wild Draw 4 can always be played (house rule: no color-check restriction)
            
    # If Wild card, ensure chosen color is valid
    if card_color == 'W':
        if chosen_color not in ['R', 'Y', 'G', 'B']:
            raise ValueError("You must choose a valid color (R, Y, G, or B) for Wild cards.")
            
    # Apply Play: Move card from hand to discard pile
    player_hand.remove(card)
    state['discard_pile'].append(card)
    state['current_value'] = card_value
    
    # Set current color
    if card_color == 'W':
        state['current_color'] = chosen_color
    else:
        state['current_color'] = card_color
        
    # Reset called_uno for the player (will be set again if they declare it this turn)
    active_player['called_uno'] = False
    
    # Handle Special Card Penalties/Actions
    step = 1
    
    # Skip
    if card_value == 'Skip':
        step = 2
        
    # Reverse
    elif card_value == 'Reverse':
        if len(state['players']) == 2:
            step = 2 # Acts as skip
        else:
            state['direction'] *= -1
            step = 1
            
    # Draw 2
    elif card_value == 'Draw2':
        state['draw_penalty'] = state.get('draw_penalty', 0) + 2
        step = 1
        
    # Wild Draw 4
    elif card_value == 'WildDraw4':
        state['draw_penalty'] = state.get('draw_penalty', 0) + 4
        step = 1
        
    # Check Win Condition
    if len(player_hand) == 0:
        state['game_status'] = 'FINISHED'
        state['winner_id'] = player_id
        state['winner_name'] = active_player['name']
        return state
        
    # Reset drawing flag for the next turn
    state['has_drawn_this_turn'] = False
    
    # Advance Turn
    advance_turn(state, step=step)
    check_deck_integrity(state)
    return state
 
def handle_draw_card(state, player_id):
    active_player = state['players'][state['current_turn']]
    if active_player['id'] != player_id:
        raise ValueError("It is not your turn.")
        
    penalty = state.get('draw_penalty', 0)
    if penalty > 0:
        # Draw exactly 1 card
        drawn = draw_cards_for_player(state, player_id, 1)
        state['draw_penalty'] = penalty - 1
        
        if state['draw_penalty'] == 0:
            # Finished drawing all penalty cards
            state['has_drawn_this_turn'] = False
            advance_turn(state, step=1)
        else:
            # Must continue drawing
            state['has_drawn_this_turn'] = True
    else:
        # Draw one card
        drawn = draw_cards_for_player(state, player_id, 1)
        state['has_drawn_this_turn'] = True
        
    # Reset UNO call status as player now has more cards
    active_player['called_uno'] = False
    check_deck_integrity(state)
    return state

def handle_pass_turn(state, player_id):
    active_player = state['players'][state['current_turn']]
    if active_player['id'] != player_id:
        raise ValueError("It is not your turn.")
        
    if not state.get('has_drawn_this_turn', False):
        raise ValueError("You must draw a card before passing.")
        
    # Reset drawing flag
    state['has_drawn_this_turn'] = False
    
    # Advance turn
    advance_turn(state, step=1)
    return state

def handle_call_uno(state, player_id):
    # Player calls UNO for themselves
    # Can only call UNO if they have exactly 1 card in hand (after playing their second-to-last card)
    player_hand = state['hands'].get(player_id, [])
    if len(player_hand) != 1:
        raise ValueError("You can only call UNO when you have exactly 1 card left.")
        
    for p in state['players']:
        if p['id'] == player_id:
            p['called_uno'] = True
            break
            
    return state

def handle_call_out_uno(state, caller_id, target_id):
    # A player calls out another player for not declaring UNO
    # Criteria: target has exactly 1 card in hand, and called_uno is False
    target_hand = state['hands'].get(target_id, [])
    if len(target_hand) != 1:
        raise ValueError("Target player does not have exactly 1 card.")
        
    target_player = None
    for p in state['players']:
        if p['id'] == target_id:
            target_player = p
            break
            
    if not target_player:
        raise ValueError("Target player not found.")
        
    if target_player['called_uno']:
        raise ValueError("Target player already declared UNO safely.")
        
    # Penalty: Target player draws 4 cards
    draw_cards_for_player(state, target_id, 4)
    
    # Reset target player's uno callout status
    target_player['called_uno'] = False
    
    check_deck_integrity(state)
    return state

def resolve_turn_timeout(state):
    """
    Auto-draws and passes for the active player disabled.
    """
    return False
