package com.englishapp.api;

import com.englishapp.service.CurrentUserService;
import com.englishapp.service.MindMapService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class GlobalMindMapController {
    private final CurrentUserService currentUserService;
    private final MindMapService mindMapService;

    public GlobalMindMapController(CurrentUserService currentUserService, MindMapService mindMapService) {
        this.currentUserService = currentUserService;
        this.mindMapService = mindMapService;
    }

    @GetMapping("/mind-map")
    public Map<String, Object> getAllMindMap() {
        return mindMapService.getAllMindMap(currentUserService.getCurrentUserId());
    }
}
