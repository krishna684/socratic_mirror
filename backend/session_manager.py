"""
Session Manager
Handles session lifecycle, context compression, and data persistence
"""
from typing import Dict, List, Optional
import json
import asyncio
from datetime import datetime, timedelta
import uuid
import os
import time


class SessionManager:
    """Manages coaching sessions with context preservation"""
    
    def __init__(self, storage_path: str = "./sessions"):
        self.storage_path = storage_path
        self.active_sessions: Dict[str, Dict] = {}
        # Debounce session saves: only write if > 5s since last write for that session
        self._last_save_time: Dict[str, float] = {}
        self._pending_save: Dict[str, bool] = {}
        os.makedirs(storage_path, exist_ok=True)
        self._cleanup_old_sessions()
        
    async def create_session(self, user_id: str, mode: str) -> Dict:
        """Create a new coaching session"""
        session_id = str(uuid.uuid4())
        
        session = {
            "session_id": session_id,
            "user_id": user_id,
            "mode": mode,
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "context_history": [],
            "biometric_timeline": [],
            "interactions": [],
            "biometric_baseline": None,
            "barge_in_sensitivity": 0.7,
            "persona": None,
            "duration": 0,
            "tutoring_step": 0,
            "interview_state": {
                "stage": "init",
                "role": "",
                "job_description": "",
                "resume": "",
                "started": False,
                "start_time": None,
                "question_count": 0,
                "max_questions": 10,
                "min_questions": 6,
                "target_minutes": 10,
                "max_minutes": 15,
                "current_question": "",
                "current_section": "",
                "hint_used": False,
                "last_question_time": None
            },
            "public_speaking_state": {
                "stage": "init",
                "speaking_type": "",
                "topic": "",
                "script": "",
                "started": False,
                "start_time": None,
                "main_speech_start": None,
                "followup_index": 0,
                "followup_total": 3,
                "word_count": 0,
                "filler_count": 0,
                "pause_count": 0,
                "long_pause_count": 0
            }
        }
        
        self.active_sessions[session_id] = session
        await self._save_session(session_id)
        
        # Trigger cleanup occasionally (every 10 sessions or so)
        if len(self.active_sessions) % 5 == 0:
            self._cleanup_old_sessions()
        
        return session
        
    async def get_session(self, session_id: str) -> Optional[Dict]:
        """Get active session or load from storage"""
        if session_id in self.active_sessions:
            return self.active_sessions[session_id]
            
        # Try to load from storage
        session_file = os.path.join(self.storage_path, f"{session_id}.json")
        if os.path.exists(session_file):
            with open(session_file, 'r') as f:
                session = json.load(f)
                
            # Check if session is still valid (within 24 hours)
            start_time = datetime.fromisoformat(session["start_time"])
            if datetime.now() - start_time < timedelta(hours=24):
                self.active_sessions[session_id] = session
                return session
                
        return None
        
    async def end_session(self, session_id: str):
        """End a session and finalize data"""
        if session_id not in self.active_sessions:
            return
            
        session = self.active_sessions[session_id]
        session["end_time"] = datetime.now().isoformat()
        
        # Calculate duration
        start = datetime.fromisoformat(session["start_time"])
        end = datetime.fromisoformat(session["end_time"])
        session["duration"] = (end - start).total_seconds()
        
        # Apply context compression if needed
        if len(session["context_history"]) > 50:
            session = await self._compress_context(session)
            
        await self._save_session(session_id, force=True)

    async def add_interaction(self, session_id: str, interaction: Dict):
        """Add interaction to session history"""
        if session_id not in self.active_sessions:
            return
            
        session = self.active_sessions[session_id]
        session["interactions"].append(interaction)
        
        # Add to context history (handle different formats)
        if "role" in interaction and "content" in interaction:
            # New direct format
            session["context_history"].append({
                "role": interaction["role"],
                "content": interaction["content"],
                "visual_content": interaction.get("visual_content", ""),
                "timestamp": interaction.get("timestamp", datetime.now().isoformat())
            })
        else:
            # Legacy format with user/assistant keys
            if "user" in interaction and interaction["user"]:
                session["context_history"].append({
                    "role": "user",
                    "content": interaction["user"],
                    "timestamp": interaction.get("timestamp", datetime.now().isoformat())
                })
            
            if "assistant" in interaction and interaction["assistant"]:
                session["context_history"].append({
                    "role": "assistant",
                    "content": interaction["assistant"],
                    "timestamp": interaction.get("timestamp", datetime.now().isoformat())
                })
        
        # Auto-compress if session is getting long (>30 minutes of history)
        if len(session["interactions"]) > 100:
            session = await self._compress_context(session)
            
        await self._save_session(session_id)
        
    async def add_biometric_data(self, session_id: str, biometric_data: Dict):
        """Add biometric data point to timeline"""
        if session_id not in self.active_sessions:
            return
            
        session = self.active_sessions[session_id]
        biometric_data["timestamp"] = datetime.now().isoformat()
        session["biometric_timeline"].append(biometric_data)
        
        # Set baseline if not set (use first 30 seconds of data)
        if not session["biometric_baseline"] and len(session["biometric_timeline"]) >= 10:
            await self._calculate_baseline(session_id)
            
    async def get_latest_biometric(self, session_id: str) -> Optional[Dict]:
        """Get most recent biometric data"""
        if session_id not in self.active_sessions:
            return None
            
        session = self.active_sessions[session_id]
        if session["biometric_timeline"]:
            return session["biometric_timeline"][-1]
        return None
        
    async def _calculate_baseline(self, session_id: str):
        """Calculate biometric baseline from initial measurements"""
        session = self.active_sessions[session_id]
        timeline = session["biometric_timeline"][:10]  # First 10 readings
        
        if not timeline:
            return
            
        avg_hr = sum(b.get("heart_rate", 70) for b in timeline) / len(timeline)
        
        session["biometric_baseline"] = {
            "resting_heart_rate": avg_hr,
            "stress_threshold": avg_hr * 1.2,  # 20% above baseline
            "calibration_date": datetime.now().isoformat()
        }
        
    async def _compress_context(self, session: Dict) -> Dict:
        """
        Apply sliding window context compression
        Preserve Thinking Signatures and key learning objectives
        """
        # Keep last 20 interactions + summary of older ones
        interactions = session["interactions"]
        
        if len(interactions) <= 30:
            return session
            
        # Keep recent interactions
        recent = interactions[-20:]
        
        # Summarize older interactions (in practice, would use Gemini for this)
        summary = {
            "type": "context_summary",
            "interaction_count": len(interactions) - 20,
            "key_topics": self._extract_key_topics(interactions[:-20]),
            "learning_objectives": session.get("learning_objectives", []),
            "pedagogical_state": "compressed_context",
            "timestamp": datetime.now().isoformat()
        }
        
        # Update session
        session["interactions"] = [summary] + recent
        session["context_compressed"] = True
        session["compression_timestamp"] = datetime.now().isoformat()
        
        return session
        
    def _extract_key_topics(self, interactions: List[Dict]) -> List[str]:
        """Extract key topics from interactions (simplified)"""
        # In production, would use Gemini to extract topics
        topics = []
        for interaction in interactions:
            user_text = interaction.get("user", "")
            if len(user_text) > 10:
                # Simple keyword extraction (would use NLP in production)
                words = user_text.split()
                if words:
                    topics.append(words[0])
        return list(set(topics))[:5]
        
    async def _save_session(self, session_id: str, force: bool = False):
        """Persist session to disk (debounced + offloaded to thread pool)."""
        if session_id not in self.active_sessions:
            return

        now = time.monotonic()
        last = self._last_save_time.get(session_id, 0)

        # Skip if saved recently and not forced (e.g. end_session)
        if not force and now - last < 5.0:
            self._pending_save[session_id] = True
            return

        self._last_save_time[session_id] = now
        self._pending_save[session_id] = False

        session_data = self.active_sessions[session_id]
        session_file = os.path.join(self.storage_path, f"{session_id}.json")

        def _write():
            with open(session_file, 'w') as f:
                json.dump(session_data, f, indent=2)

        await asyncio.to_thread(_write)

    def _cleanup_old_sessions(self, max_age_hours: int = 24):
        """Delete session files older than max_age_hours"""
        try:
            now = datetime.now()
            count = 0
            for filename in os.listdir(self.storage_path):
                if filename.endswith(".json"):
                    file_path = os.path.join(self.storage_path, filename)
                    file_time = datetime.fromtimestamp(os.path.getmtime(file_path))
                    if now - file_time > timedelta(hours=max_age_hours):
                        os.remove(file_path)
                        count += 1
            if count > 0:
                print(f"Cleaned up {count} old session files.")
        except Exception as e:
            print(f"Error during session cleanup: {e}")
