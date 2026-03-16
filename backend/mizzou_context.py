"""
Mizzou-Specific Context and Integration
Campus landmarks, academic programs, and local references
"""
from typing import Dict, List, Optional
import random


class MizzouContext:
    """Mizzou-specific context for personalized coaching"""
    
    # Campus landmarks
    LANDMARKS = [
        "Lafferre Hall",
        "The Columns",
        "Jesse Hall",
        "Student Center",
        "Engineering Building",
        "Ellis Library",
        "Memorial Union",
        "Faurot Field",
        "Mizzou Arena",
        "Reactor Building"
    ]
    
    # Academic programs
    PROGRAMS = [
        "Computer Science",
        "Engineering",
        "Business Administration",
        "Journalism",
        "Medicine",
        "Law",
        "Veterinary Medicine",
        "Agriculture",
        "Education",
        "Arts and Science"
    ]
    
    # Local references
    REFERENCES = {
        "mascot": "Truman the Tiger",
        "colors": "Black and Gold",
        "motto": "Salus Populi (The welfare of the people)",
        "founded": "1839",
        "location": "Columbia, Missouri",
        "nickname": "Mizzou",
        "athletic_conference": "SEC"
    }
    
    # Lafferre Hall specific details for visualizations
    LAFFERRE_HALL = {
        "name": "Lafferre Hall",
        "description": "Cinematic glass-and-brick architecture atrium",
        "features": ["Modern glass atrium", "Natural lighting", "Collaborative spaces", "Technology integration"],
        "use_case": "Engineering and technology building"
    }
    
    @staticmethod
    def get_random_landmark() -> str:
        """Get random Mizzou landmark"""
        return random.choice(MizzouContext.LANDMARKS)
        
    @staticmethod
    def get_context_for_scenario(scenario_type: str) -> Dict[str, any]:
        """Get Mizzou context for specific scenario type"""
        if scenario_type == "interview":
            return {
                "location": "Mizzou Career Center",
                "interviewer_background": f"Mizzou {random.choice(MizzouContext.PROGRAMS)} alumni",
                "references": [
                    "your experience at Mizzou",
                    "campus involvement",
                    f"knowledge of {random.choice(MizzouContext.PROGRAMS)}"
                ]
            }
        elif scenario_type == "presentation":
            return {
                "location": random.choice(MizzouContext.LANDMARKS),
                "audience": "Mizzou students and faculty",
                "topics": [
                    f"Research in {random.choice(MizzouContext.PROGRAMS)}",
                    "Campus innovation initiatives",
                    "Student organization updates"
                ]
            }
        elif scenario_type == "tutoring":
            return {
                "location": "Ellis Library study room",
                "subject_context": f"{random.choice(MizzouContext.PROGRAMS)} coursework",
                "examples": [
                    "Mizzou-specific case studies",
                    "Local research applications"
                ]
            }
        else:
            return {
                "location": random.choice(MizzouContext.LANDMARKS),
                "context": "Mizzou campus environment"
            }
            
    @staticmethod
    def inject_mizzou_references(prompt: str, scenario_type: str) -> str:
        """Inject Mizzou context into prompts"""
        context = MizzouContext.get_context_for_scenario(scenario_type)
        
        mizzou_context = f"""
Setting: {context.get('location', 'Mizzou campus')}
Institution: University of Missouri (Mizzou)
Context: {context.get('context', 'Professional coaching session at Mizzou')}
"""
        
        return f"{mizzou_context}\n\n{prompt}"
        
    @staticmethod
    def get_future_visualization_prompt(peak_confidence_data: Dict) -> str:
        """
        Generate prompt for Future Self visualization
        Places user in Lafferre Hall with success imagery
        """
        prompt = f"""Create a photorealistic 4K image of a confident professional in the Lafferre Hall atrium at the University of Missouri.

Setting: {MizzouContext.LAFFERRE_HALL['description']}
- Modern architectural space with glass walls and natural lighting
- Professional yet academic atmosphere
- Mizzou branding subtle in background

Subject: Confident, successful individual
- Professional attire appropriate for {random.choice(MizzouContext.PROGRAMS)}
- Posture suggesting confidence and achievement
- Engaged in successful presentation or leadership moment
- Surrounded by impressed colleagues/audience

Lighting: Cinematic natural lighting through the glass atrium
Style: Photorealistic, inspirational, professional
Mood: Achievement, confidence, success

The image should capture a peak moment of professional success at Mizzou."""

        return prompt
